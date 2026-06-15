let table;
// Configure the DataTable
$(document).ready(function() {
  if (!folderViewEnabled) {
    disableFolders();
  }

  table = $('#campaigns').DataTable({
    language: dataTablesLanguage,
    serverSide: true,
    stateSave: false,
    stateDuration: 0,
    responsive: true,
    dom: dataTablesTemplate,
    stateLoadCallback: dataTableStateLoadCallback,
    stateSaveCallback: dataTableStateSaveCallback,
    filter: false,
    searchDelay: 3000,
    order: [[0, 'asc']],
    ajax: {
      url: campaignSearchURL,
      data: function(d) {
        $.extend(
          d,
          $('#campaigns').closest('.XiboGrid')
            .find('.FilterDiv form').serializeObject(),
        );
      },
    },
    columns: [
      {
        data: 'campaign',
        responsivePriority: 2,
        render: dataTableSpacingPreformatted,
      },
      // Add fields only if campaign is enabled
      ...(adCampaignEnabled ? [
        {
          data: 'type',
          responsivePriority: 2,
          render: function(data, type) {
            if (type !== 'display') {
              return data;
            } else if (data === 'list') {
              return campaignPageTrans.list;
            } else if (data === 'ad') {
              return campaignPageTrans.ad;
            }
            return data;
          },
        },
        {
          data: 'startDt',
          responsivePriority: 2,
           render: dataTableDateFromUnix,
           visible: false,
        },
        {
          data: 'endDt',
          responsivePriority: 2,
           render: dataTableDateFromUnix,
           visible: false,
        },
      ] : []),
      {data: 'numberLayouts', responsivePriority: 2},
      // Add tags only if enabled
      ...(taggingEnabled ? [{
        sortable: false,
        responsivePriority: 2,
        data: dataTableCreateTags,
      }] : []),
      {
        data: 'totalDuration',
        responsivePriority: 2,
        render: dataTableTimeFromSeconds,
      },
      {
        name: 'cyclePlaybackEnabled',
        responsivePriority: 3,
        visible: false,
        data: function(data, type) {
          if (type != 'display') {
            return data.cyclePlaybackEnabled;
          }

          let icon = '';
          if (data.cyclePlaybackEnabled == 1) {
            icon = 'fa-check';
          } else {
            icon = 'fa-times';
          }

          return '<span class="fa ' + icon + '"></span>';
        },
      },
      {
        name: 'playCount',
        responsivePriority: 3,
        visible: false,
        data: function(data, type) {
          if (type !== 'display') {
            return data.playCount;
          }

          if (!data.playCount) {
            return '';
          } else {
            return data.playCount;
          }
        },
      },
      // Add fields only if campaign is enabled
      ...(adCampaignEnabled ? [
        {
          data: 'targetType',
          responsivePriority: 3,
          visible: false,
          render: function(data, type) {
            if (data === 'plays') {
              return campaignPageTrans.plays;
            } else if (data === 'budget') {
              return campaignPageTrans.budget;
            } else if (data === 'imp') {
              return campaignPageTrans.impressions;
            }
            return data;
          },
        },
        {
          data: 'target',
          visible: false,
          responsivePriority: 3,
        },
        {
          data: 'plays',
          responsivePriority: 6,
          visible: false,
        },
        {
          data: 'spend',
          responsivePriority: 6,
          visible: false,
        },
        {
          data: 'impressions',
          responsivePriority: 6,
          visible: false,
        },
      ] : []),
      {
        data: 'ref1',
        responsivePriority: 10,
        visible: false,
      },
      {
        data: 'ref2',
        responsivePriority: 10,
        visible: false,
      },
      {
        data: 'ref3',
        responsivePriority: 10,
        visible: false,
      },
      {
        data: 'ref4',
        responsivePriority: 10,
        visible: false,
      },
      {
        data: 'ref5',
        responsivePriority: 10,
        visible: false,
      },
      {
        name: 'schedules',
        orderable: false,
        sortable: false,
        responsivePriority: 3,
        width: '120px',
        data: function(data) {
          if (!data.schedules || data.schedules.length === 0) {
            return '<span class="text-muted">-</span>';
          }
          return data.schedules.map(function(s) {
            var scheduleEditUrl = $('#campaigns').data('scheduleEditUrl');
            var url = scheduleEditUrl.replace(':id', s.eventId);
            return '<a class="XiboFormButton" href="' + url + '" style="color:#28a745;font-weight:bold;">' + s.name + '</a>';
          }).join('<br>');
        },
      },
      {
        data: 'createdAt',
        responsivePriority: 5,
        render: dataTableDateFromIso,
        visible: false,
      },
      {
        data: 'modifiedAt',
        responsivePriority: 5,
        render: dataTableDateFromIso,
        visible: false,
      },
      {
        data: 'modifiedByName',
        responsivePriority: 5,
        visible: false,
      },
      {
        orderable: false,
        responsivePriority: 1,
        data: dataTableButtonsColumn,
      },
    ],
  });

  // Data Table events
  table.on('draw', dataTableDraw);
  table.on('draw',
    {
      form: $('#campaigns').closest('.XiboGrid')
        .find('.FilterDiv form'),
    }, dataTableCreateTagEvents);
  table.on('processing.dt', dataTableProcessing);
  dataTableAddButtons(
    table,
    $('#campaigns_wrapper').find('.dataTables_buttons'),
  );

  $('#refreshGrid').click(function() {
    table.ajax.reload();
  });
});

import '../../campaign/campaign-assign-layouts.js';

/**
 * Called when the campaign add form is opened
 * @param dialog
 */
window.campaignAddFormOpen = function(dialog) {
  // setup checkbox behaviour for cycle based playback
  formHelpers.setupCheckboxInputFields(
    $(dialog).find('form'),
    'input[name="cyclePlaybackEnabled"]',
    '.cycle-based-playback',
    '.no-cycle-based-playback',
  );

  const $type = $(dialog).find('select[name=type]');
  const $cycleBased = $('input[name="cyclePlaybackEnabled"]');

  $(dialog).find('.campaign-type-ad').toggle($type.val() === 'ad');

  $type.on('change', function() {
    $(dialog).find('.campaign-type-list').toggle($type.val() !== 'ad');
    $(dialog).find('.campaign-type-ad').toggle($type.val() === 'ad');

    $(dialog).find('.cycle-based-playback')
      .toggle($cycleBased.is(':checked') && $type.val() !== 'ad');
    $(dialog).find('.no-cycle-based-playback')
      .toggle(!$cycleBased.is(':checked') && $type.val() !== 'ad');
  });
};

/**
 * Called when the campaign add form is submitted.
 * @param xhr
 * @param form
 */
window.campaignAddFormSubmitCallback = function(xhr, form) {
  if (xhr.success) {
    if (xhr.data.type === 'ad') {
      // Navigate to the campaign builder
    } else {
      // Open the edit form.
      XiboFormRender(
        $(form).data('editFormUrl').replace(':id', xhr.data.campaignId),
      );
    }
  }
};
