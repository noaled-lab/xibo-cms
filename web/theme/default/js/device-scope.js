/* Shared device context for resource lists. Names are inserted as text. */
(function($) {
  'use strict';

  const bar = document.getElementById('device-scope');
  if (!bar) return;

  const $bar = $(bar);
  const storageKey = bar.dataset.storageKey;
  const filterEnabled = bar.dataset.filterEnabled === 'true';
  let selected = '';
  let displays = [];
  try {
    selected = sessionStorage.getItem(storageKey) || '';
  } catch {/* Storage may be disabled. */}

  // Register before page scripts initialise their DataTables.
  $(document).on('preXhr.dt.deviceScope', function(event, settings, data) {
    if (!filterEnabled) return;
    const id = settings.nTable.id;
    if (['layouts', 'templates', 'resolutions'].includes(id)) {
      if (id === 'layouts' && selected) delete data.activeDisplayGroupId;
      // The top-level device's dimensions replace any saved resolution filter.
      if (selected) delete data.resolutionId;
      if (selected) data.contextDisplayId = selected;
    } else if (id === 'schedule-grid' && getScheduleDisplay()) {
      delete data['displayGroupIds[]'];
      delete data.displayGroupIds;
      delete data.displaySpecificGroupIds;
      data['displaySpecificGroupIds[]'] = [getScheduleDisplay().displayGroupId];
      delete data.showAll;
    } else if (id === 'displays' && selected) {
      data.displayId = selected;
    }
  });

  function getScheduleDisplay() {
    if (!filterEnabled) return null;
    return displays.find(function(item) {
      return String(item.displayId) === selected;
    }) || null;
  }

  window.deviceScope = {
    getScheduleDisplay: getScheduleDisplay,
    getDisplayId: function() {
      return selected;
    },
  };

  function save() {
    try {
      sessionStorage.setItem(storageKey, selected);
    } catch {/* Keep working without persistence. */}
  }

  function refresh() {
    if (!filterEnabled) return;
    // Keep native values intact; override only outgoing requests.
    $('#resolutionId, #activeDisplayGroupId, ' +
      '#DisplayList, #DisplayGroupList, #showAll')
      .attr('data-device-scope-preserved', selected ? 'true' : null)
      .closest('.form-group').toggle(!selected);
    $('.device-scope-filter-note').remove();
    if (selected) {
      $('.XiboFilter').first().prepend(
        $('<div>', {class: 'device-scope-filter-note px-3 pt-3 text-muted',
          role: 'status', text: bar.dataset.filterNote}),
      );
    }
    if ($('#DisplayList').length && window.calendar) {
      $('.cal-context').removeData('selectedTab');
      window.calendar.view();
    }

    const tables = ['layouts', 'templates', 'resolutions',
      'displays', 'schedule-grid'];
    tables.forEach(function(id) {
      const table = document.getElementById(id);
      if (table && $.fn.dataTable.isDataTable(table)) {
        $(table).DataTable().ajax.reload();
      }
    });
    $(document).trigger('deviceScope:change', [selected]);
  }

  function select(id) {
    selected = id;
    save();
    $bar.find('[data-display-id]').each(function(index, button) {
      const active = button.dataset.displayId === selected;
      $(button).toggleClass('active', active)
        .attr('aria-pressed', String(active));
    });
    refresh();
  }

  $bar.on('click', '[data-display-id]', function(event) {
    const id = event.currentTarget.dataset.displayId;
    if (id !== selected) select(id);
  });

  function load(start, accumulated) {
    $bar.attr('aria-busy', 'true');
    $.getJSON(bar.dataset.searchUrl, {
      start: start, length: 100,
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

  $(document).on('shown.bs.modal.deviceScope', function() {
    const $links = $('#cameraAddForm select[name="displayIds[]"]');
    if (selected && $links.length && !$links.val()?.length) {
      $links.val([selected]).trigger('change');
    }
  });
})(jQuery);
