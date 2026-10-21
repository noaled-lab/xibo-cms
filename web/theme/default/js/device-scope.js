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

  // Register before page scripts initialise their DataTables.
  $(document).on('preXhr.dt.deviceScope', function(event, settings, data) {
    const id = settings.nTable.id;
    if (['layouts', 'templates', 'resolutions'].includes(id)) {
      if (id === 'layouts') delete data.activeDisplayGroupId;
      // The top-level device's dimensions replace any saved resolution filter.
      if (selected) delete data.resolutionId;
      if (selected) data.contextDisplayId = selected;
    } else if (id === 'displays' && selected) {
      data.displayId = selected;
    }
  });

  window.deviceScope = {
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
    const display = displays.find(function(item) {
      return String(item.displayId) === selected;
    });

    // Use the calendar's native filter so month, agenda and list agree.
    if ($('#DisplayList').length) {
      const $list = $('#DisplayList');
      $('#DisplayGroupList').val(null).trigger('change.select2');
      const targets = display ? [display] : displays;
      targets.forEach(function(target) {
        const groupId = String(target.displayGroupId);
        if (!$list.find('option').toArray().some(function(option) {
          return option.value === groupId;
        })) {
          const option = new Option(target.display, groupId);
          option.setAttribute('type', '1');
          $list.append(option);
        }
      });
      $list.prop('disabled', false).val(targets.map(function(target) {
        return String(target.displayGroupId);
      }));
      $('#showAll').prop('checked', false);
      $('.cal-context').removeData('selectedTab');
      $list.trigger('change');
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
    $('#resolutionId').prop('disabled', Boolean(selected));
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
    selected = '';
    save();
    refresh();
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
    $('#activeDisplayGroupId').closest('.form-group').hide();
    $('#DisplayList, #DisplayGroupList').closest('.form-group').hide();
    load(0, []);
  });

  $(document).on('shown.bs.modal.deviceScope', function() {
    const $links = $('#cameraAddForm select[name="displayIds[]"]');
    if (selected && $links.length && !$links.val()?.length) {
      $links.val([selected]).trigger('change');
    }
  });
})(jQuery);
