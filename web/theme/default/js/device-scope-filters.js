/* Page adapters for the shared device selection. */
(function($) {
  'use strict';
  const scope = window.deviceScope;
  const bar = document.getElementById('device-scope');
  if (!scope || !bar) return;

  // Read when a layout is created. The editor applies a later user selection.
  scope.getLayoutDefaults = function() {
    const resolution = scope.getDisplay()?.scopeResolution || '';
    const dimensions = resolution.match(/^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i);
    const valid = dimensions &&
      Number(dimensions[1]) > 0 && Number(dimensions[2]) > 0;
    return valid ? {
      contextWidth: Number(dimensions[1]),
      contextHeight: Number(dimensions[2]),
    } : {};
  };

  $(document).on('shown.bs.modal.deviceScope', function() {
    const selected = scope.getDisplayId();
    const $links = $('#cameraAddForm select[name="displayIds[]"]');
    if (selected && $links.length && !$links.val()?.length) {
      $links.val([selected]).trigger('change');
    }
  });
  if (bar.dataset.filterEnabled !== 'true') return;

  // The same target rule is used by list, calendar, agenda and add form.
  function scheduleTargets(groups, displays) {
    const display = scope.getDisplay();
    return display ? {
      groups: [], displays: [display.displayGroupId], display: display,
    } : {groups: groups || [], displays: displays || [], display: null};
  }

  function applySchedule(data) {
    const targets = scheduleTargets();
    if (!targets.display) return;
    delete data['displayGroupIds[]'];
    delete data.displayGroupIds;
    delete data.displaySpecificGroupIds;
    data['displaySpecificGroupIds[]'] = targets.displays;
    delete data.showAll;
  }

  window.deviceScopeFilters = {scheduleTargets: scheduleTargets};

  // Register before page scripts initialise their DataTables.
  $(document).on('preXhr.dt.deviceScope', function(event, settings, data) {
    const selected = scope.getDisplayId();
    const id = settings.nTable.id;
    if (['layouts', 'templates', 'resolutions'].includes(id)) {
      if (id === 'layouts' && selected) delete data.activeDisplayGroupId;
      // The top-level device's dimensions replace any saved resolution filter.
      if (selected) delete data.resolutionId;
      if (selected) data.contextDisplayId = selected;
    } else if (id === 'schedule-grid') {
      applySchedule(data);
    } else if (id === 'displays' && selected) {
      data.displayId = selected;
    }
  });

  function refresh() {
    const selected = scope.getDisplayId();
    // Keep native values intact; override only outgoing requests.
    $('#resolutionId, #activeDisplayGroupId, ' +
      '#DisplayList, #DisplayGroupList, #showAll')
      .attr('data-device-scope-preserved', selected ? 'true' : null)
      .closest('.form-group').toggle(!selected);
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
  }

  $(document).on('deviceScope:change', refresh);
})(jQuery);
