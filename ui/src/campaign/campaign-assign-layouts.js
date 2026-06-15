function layoutAssignSubmit($form) {
  if (parseInt($form.find('input[name="manageLayouts"]').val()) === 1) {
    const finalLayoutPositions = [];
    $('#LayoutAssignSortable').find('li').each(function(key, el) {
      finalLayoutPositions.push($(el).data('layoutId'));
    });

    for (let i = 0; i < finalLayoutPositions.length; i++) {
      $('<input>').attr({
        type: 'hidden',
        name: 'layoutIds[' + i + ']',
      }).val(finalLayoutPositions[i]).appendTo($form.find('#assignLayouts'));
    }
  }
}

window.campaignAssignLayoutsFormOpen = function(dialog) {
  formHelpers.setupCheckboxInputFields(
    $(dialog).find('form:not(.form-inline)'),
    'input[name="cyclePlaybackEnabled"]',
    '.cycle-based-playback',
    '.no-cycle-based-playback',
  );

  const layoutElementTemplate = templates.campaign.campaignAssignLayout;

  const layoutAssignFilter = $(dialog).find('.layoutAssignFilterOptions');

  layoutAssignFilter.find('input#tags').attr('id', 'tagsFilter');

  const $layoutAssignments = $('#layoutAssignments');

  const $layoutAssignSortable = $('#LayoutAssignSortable');

  const updateSortablePositions = function() {
    dialog.find('input[name="manageLayouts"]').val(1);

    $layoutAssignSortable.find('li').each(function(idx, el) {
      $(el).find('.layout-order').html(idx + 1);
    });
  };

  const layoutsArray = $layoutAssignSortable.data('layouts');
  for (let layoutIndex = 0; layoutIndex < layoutsArray.length; layoutIndex++) {
    const layout = layoutsArray[layoutIndex];

    const newItem = layoutElementTemplate({
      index: (layoutIndex + 1),
      layoutId: layout.layoutId,
      layoutName: layout.layout,
      locked: layout.locked,
    });

    $(newItem).appendTo('#LayoutAssignSortable');
  }

  const layoutTable = $layoutAssignments.DataTable({
    language: dataTablesLanguage,
    serverSide: true,
    stateSave: true,
    stateDuration: 0,
    pageLength: 5,
    lengthMenu: [5, 10, 25, 50],
    stateLoadCallback: dataTableStateLoadCallback,
    stateSaveCallback: dataTableStateSaveCallback,
    searchDelay: 3000,
    order: [[0, 'asc']],
    filter: false,
    ajax: {
      url: layoutSearchURL + '?retired=0',
      data: function(d) {
        $.extend(d, $layoutAssignments.closest('.XiboGrid')
          .find('.layoutAssignFilterOptions')
          .find('input, select')
          .serializeObject());
      },
    },
    columns: [
      {data: 'layoutId'},
      {
        data: 'layout',
        render: dataTableSpacingPreformatted,
      },
      {
        name: 'status',
        data: function(data, type) {
          if (type != 'display') {
            return data.status;
          }

          let icon = '';
          if (data.status == 1) {
            icon = 'fa-check';
          } else if (data.status == 2) {
            icon = 'fa-exclamation';
          } else if (data.status == 3) {
            icon = 'fa-cogs';
          } else {
            icon = 'fa-times';
          }

          return '<span class=\'fa ' + icon +
            '\' title=\'' + (data.statusDescription) +
            ((data.statusMessage == null) ? '' : ' - ' + (data.statusMessage)) +
            '\'></span>';
        },
      },
      {
        sortable: false,
        data: function(data, type, row, meta) {
          if (type !== 'display') {
            return '';
          }
          return '<a href="#" class="assignItem"><span class="fa fa-plus"></a>';
        },
      },
    ],
  });

  layoutTable.on(
    'draw',
    {
      form: $layoutAssignments.closest('.XiboGrid').find('form'),
    }, function(e, settings) {
      dataTableDraw(e, settings);
      dataTableCreateTagEvents(e, settings);

      $layoutAssignments.find('.assignItem').on('click', function(ev) {
        const data = layoutTable.row($(ev.currentTarget).closest('tr')).data();

        const newItem = layoutElementTemplate({
          index: ($('#LayoutAssignSortable').find('li').length + 1),
          layoutId: data.layoutId,
          layoutName: data.layout,
          locked: false,
        });

        $(newItem).appendTo('#LayoutAssignSortable');

        dialog.find('input[name="manageLayouts"]').val(1);
      });
    });
  layoutTable.on('processing.dt', dataTableProcessing);

  $layoutAssignSortable.sortable({
    cancel: '.ui-state-disabled',
    update: function(event, ui) {
      updateSortablePositions();
    },
  });

  $layoutAssignSortable.on('click', '.layout-remove', function(ev) {
    $(ev.currentTarget).parent().remove();
    updateSortablePositions();
  });

  layoutAssignFilter.find('input, select').change(function() {
    layoutTable.ajax.reload();
  });

  $(dialog).find('.nav-tabs a').on('shown.bs.tab', function(event) {
    if ($(event.target).attr('href') === '#tab-layouts') {
      layoutAssignFilter.find('input, select').prop('disabled', false);
      layoutTable.columns.adjust().draw();
    }
  });
};

window.campaignFormSubmit = function($form) {
  layoutAssignSubmit($form);

  $('.layoutAssignFilterOptions').find('input, select').prop('disabled', true);

  $form.submit();
};
