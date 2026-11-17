<?php

namespace Xibo\Support;

/**
 * Play time of a fragmented MP4. Its header carries no duration, so getID3 guesses one from a single fragment.
 */
class FragmentedMp4
{
    /**
     * @return float|null seconds, or null when the file is not a fragmented MP4
     */
    public static function duration(string $file): ?float
    {
        $handle = is_file($file) ? @fopen($file, 'rb') : false;
        if ($handle === false) {
            return null;
        }

        try {
            return self::read($handle, filesize($file));
        } finally {
            fclose($handle);
        }
    }

    private static function read($handle, int $fileSize): ?float
    {
        $fragmented = false;
        $movieScale = 0;
        $fragmentDuration = 0;
        $scales = [];
        $defaults = [];
        $ends = [];

        foreach (self::boxes($handle, 0, $fileSize) as [$type, $start, $end]) {
            if ($type === 'moov') {
                foreach (self::boxes($handle, $start, $end) as [$childType, $childStart, $childEnd]) {
                    if ($childType === 'mvhd') {
                        $movieScale = self::timing(self::body($handle, $childStart, $childEnd))[0];
                    } elseif ($childType === 'trak') {
                        [$trackId, $scale] = self::track($handle, $childStart, $childEnd);
                        $scales[$trackId] = $scale;
                    } elseif ($childType === 'mvex') {
                        $fragmented = true;
                        foreach (self::boxes($handle, $childStart, $childEnd) as [$extendsType, $s, $e]) {
                            $body = self::body($handle, $s, $e);
                            if ($extendsType === 'mehd') {
                                $fragmentDuration = ord($body[0] ?? "\0") === 1
                                    ? self::uint64($body, 4)
                                    : self::uint32($body, 4);
                            } elseif ($extendsType === 'trex') {
                                $defaults[self::uint32($body, 4)] = self::uint32($body, 12);
                            }
                        }
                    }
                }

                if (!$fragmented) {
                    return null;
                }
            } elseif ($type === 'moof' && $fragmented) {
                foreach (self::boxes($handle, $start, $end) as [$childType, $childStart, $childEnd]) {
                    if ($childType === 'traf') {
                        self::fragment($handle, $childStart, $childEnd, $defaults, $ends);
                    }
                }
            }
        }

        if (!$fragmented) {
            return null;
        }

        if ($fragmentDuration > 0 && $movieScale > 0) {
            return $fragmentDuration / $movieScale;
        }

        // The longest track decides, as audio usually runs a little past the last video frame
        $seconds = 0.0;
        foreach ($ends as $trackId => $endTime) {
            if (($scales[$trackId] ?? 0) > 0) {
                $seconds = max($seconds, $endTime / $scales[$trackId]);
            }
        }
        return $seconds;
    }

    /**
     * Add the samples of one track fragment to the end time of its track.
     */
    private static function fragment($handle, int $start, int $end, array $defaults, array &$ends): void
    {
        $trackId = 0;
        $defaultDuration = null;
        $baseTime = null;
        $runs = [];

        foreach (self::boxes($handle, $start, $end) as [$type, $s, $e]) {
            if ($type === 'tfhd') {
                $body = self::body($handle, $s, $e);
                $flags = self::uint32($body, 0) & 0xFFFFFF;
                $trackId = self::uint32($body, 4);
                $position = 8 + (($flags & 0x01) ? 8 : 0) + (($flags & 0x02) ? 4 : 0);
                if ($flags & 0x08) {
                    $defaultDuration = self::uint32($body, $position);
                }
            } elseif ($type === 'tfdt') {
                $body = self::body($handle, $s, $e);
                $baseTime = ord($body[0] ?? "\0") === 1 ? self::uint64($body, 4) : self::uint32($body, 4);
            } elseif ($type === 'trun') {
                $runs[] = self::body($handle, $s, $e, $e - $s);
            }
        }

        $defaultDuration ??= $defaults[$trackId] ?? 0;
        $duration = 0;
        foreach ($runs as $run) {
            $flags = self::uint32($run, 0) & 0xFFFFFF;
            $count = self::uint32($run, 4);
            if (!($flags & 0x100)) {
                $duration += $count * $defaultDuration;
                continue;
            }

            $position = 8 + (($flags & 0x01) ? 4 : 0) + (($flags & 0x04) ? 4 : 0);
            $stride = 4 * count(array_filter([0x100, 0x200, 0x400, 0x800], fn($bit) => $flags & $bit));
            for ($i = 0; $i < $count; $i++) {
                $duration += self::uint32($run, $position + $i * $stride);
            }
        }

        $endTime = ($baseTime ?? $ends[$trackId] ?? 0) + $duration;
        $ends[$trackId] = max($ends[$trackId] ?? 0, $endTime);
    }

    /**
     * @return array [track id, media timescale]
     */
    private static function track($handle, int $start, int $end): array
    {
        $trackId = 0;
        $scale = 0;
        foreach (self::boxes($handle, $start, $end) as [$type, $s, $e]) {
            if ($type === 'tkhd') {
                $body = self::body($handle, $s, $e);
                $trackId = self::uint32($body, ord($body[0] ?? "\0") === 1 ? 20 : 12);
            } elseif ($type === 'mdia') {
                foreach (self::boxes($handle, $s, $e) as [$mediaType, $ms, $me]) {
                    if ($mediaType === 'mdhd') {
                        $scale = self::timing(self::body($handle, $ms, $me))[0];
                    }
                }
            }
        }
        return [$trackId, $scale];
    }

    /**
     * mvhd and mdhd share the layout of their timescale and duration.
     * @return array [timescale, duration]
     */
    private static function timing(string $body): array
    {
        if (ord($body[0] ?? "\0") === 1) {
            return [self::uint32($body, 20), self::uint64($body, 24)];
        }
        return [self::uint32($body, 12), self::uint32($body, 16)];
    }

    /**
     * Walk the boxes between two offsets, yielding [type, body start, body end].
     */
    private static function boxes($handle, int $start, int $end): \Generator
    {
        $offset = $start;
        while ($offset + 8 <= $end) {
            fseek($handle, $offset);
            $header = fread($handle, 8);
            if (strlen($header) < 8) {
                return;
            }

            $size = self::uint32($header, 0);
            $bodyStart = $offset + 8;
            if ($size === 1) {
                $size = self::uint64(fread($handle, 8), 0);
                $bodyStart += 8;
            } elseif ($size === 0) {
                $size = $end - $offset;
            }

            if ($offset + $size > $end || $offset + $size < $bodyStart) {
                return;
            }

            yield [substr($header, 4, 4), $bodyStart, $offset + $size];
            $offset += $size;
        }
    }

    private static function body($handle, int $start, int $end, int $limit = 256): string
    {
        $length = min($end - $start, $limit);
        if ($length <= 0) {
            return '';
        }
        fseek($handle, $start);
        return (string)fread($handle, $length);
    }

    private static function uint32(string $data, int $offset): int
    {
        return strlen($data) >= $offset + 4 ? unpack('N', $data, $offset)[1] : 0;
    }

    private static function uint64(string $data, int $offset): int
    {
        return strlen($data) >= $offset + 8 ? unpack('J', $data, $offset)[1] : 0;
    }
}
