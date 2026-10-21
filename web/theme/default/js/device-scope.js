/* Shared device context for resource lists. Names are inserted as text. */
(function($) {
  'use strict';

  const bar = document.getElementById('device-scope');
  if (!bar) return;

  const $bar = $(bar);
  const storageKey = bar.dataset.storageKey;
  let selected = '';
  let displays = [];
  try {
    selected = sessionStorage.getItem(storageKey) || '';
  } catch {/* Storage may be disabled. */}

  window.deviceScope = {
    getDisplay: function() {
      return displays.find(function(item) {
        return String(item.displayId) === selected;
      }) || null;
    },
    getDisplayId: function() {
      return selected;
    },
  };

  function save() {
    try {
      sessionStorage.setItem(storageKey, selected);
    } catch {/* Keep working without persistence. */}
  }

  function select(id) {
    selected = id;
    save();
    $bar.find('[data-display-id]').each(function(index, button) {
      const active = button.dataset.displayId === selected;
      $(button).toggleClass('active', active)
        .attr('aria-pressed', String(active));
    });
    $(document).trigger('deviceScope:change', [selected]);
  }

  $bar.on('click', '[data-display-id]', function(event) {
    const id = event.currentTarget.dataset.displayId;
    if (id !== selected) select(id);
  });

  function load(start, accumulated) {
    $bar.attr('aria-busy', 'true');
    $.getJSON(bar.dataset.searchUrl, {
      start: start, length: 100, embed: 'scopeResolution',
    }).done(function(result) {
      const page = result.data;
      if (!Array.isArray(page)) {
        failed();
        return;
      }
      const items = accumulated.concat(page);
      if (page.length && items.length < Number(result.recordsTotal)) {
        load(start + page.length, items);
        return;
      }
      displays = items.sort(function(a, b) {
        return a.display.localeCompare(b.display);
      });
      $bar.find('.device-scope-retry').remove();
      displays.forEach(function(display) {
        $('<button>', {
          type: 'button', class: 'btn btn-sm device-scope-tag',
          text: display.display,
          title: display.scopeResolution || bar.dataset.unknownResolution,
          'data-display-id': String(display.displayId),
          'aria-pressed': 'false',
        }).appendTo($bar);
      });
      // Deleted devices must not leave an invisible filter.
      if (!displays.some(function(item) {
        return String(item.displayId) === selected;
      })) selected = '';
      $bar.attr('aria-busy', 'false');
      select(selected);
    }).fail(failed);
  }

  function failed() {
    $bar.attr('aria-busy', 'false');
    select('');
    if (!$bar.find('.device-scope-retry').length) {
      $('<button>', {
        type: 'button', class: 'btn btn-sm btn-link device-scope-retry',
        text: bar.dataset.retry, title: bar.dataset.error,
      }).on('click', function() {
        load(0, []);
      }).appendTo($bar);
    }
  }

  $(function() {
    load(0, []);
  });
})(jQuery);
