/* Keep the open layout the same size as the display selected at the top.
 * A new layout already uses that size. Opening a different layout asks
 * before moving existing regions. Keeping the layout clears the selection
 * so the two sizes are not shown together. */

function checkboxValue(value) {
  return Number(value) === 1 ? 1 : 0;
}

function buildResolutionSave(layout, target) {
  const width = Number(target?.contextWidth);
  const height = Number(target?.contextHeight);
  if (!width || !height ||
      (Number(layout.width) === width && Number(layout.height) === height)) {
    return null;
  }

  const previous = {
    backgroundColor: layout.backgroundColor,
    backgroundImageId: layout.backgroundImage,
    backgroundzIndex: layout.backgroundzIndex,
    autoApplyTransitions: checkboxValue(layout.autoApplyTransitions),
    contextWidth: Number(layout.width),
    contextHeight: Number(layout.height),
  };
  return {
    previous: previous,
    next: Object.assign({}, previous, {
      contextWidth: width,
      contextHeight: height,
    }),
  };
}

function needsConfirm(layout) {
  try {
    return typeof layout.isEmpty === 'function' && !layout.isEmpty();
  } catch {
    return true;
  }
}

function errorText(error) {
  if (typeof error === 'string' && error) return error;
  return error?.message || error?.errorThrown || '해상도를 변경하지 못했습니다.';
}

function bindDeviceResolution(app) {
  let busy = false;
  let handled = '';
  const canEdit = () => Boolean(app.layout?.editable) && !app.readOnlyMode &&
    !app.interactiveMode && !app.interactiveEditWidgetMode &&
    !app.editorContainer.hasClass('locked-for-user');
  const pending = () => app.propertiesPanel?.toSave ||
    app.propertiesPanel?.toSaveElementCallback ||
    app.pendingAddedItems > 0 ||
    app.historyManager?.changeHistory?.some((change) => change.uploading);

  async function align(fromUser) {
    if (busy || !app.layout?.layoutId) return;
    const scope = window.deviceScope;
    const displayId = scope?.getDisplayId?.() || '';
    const save = buildResolutionSave(
      app.layout, scope?.getLayoutDefaults?.() || {});
    if (!save) return;
    const key = [app.layout.layoutId, displayId, canEdit() ? 1 : 0].join(':');
    if (!fromUser && handled === key) return;

    if (!canEdit()) {
      handled = key;
      toastr.info(
        '위 선택과 이 레이아웃의 크기가 다릅니다. 체크아웃하면 맞출 수 있습니다.');
      return;
    }
    if (pending()) {
      if (fromUser) toastr.info('편집을 마친 뒤 다시 선택해 주세요.');
      return;
    }

    busy = true;
    handled = key;
    const $buttons = $('#device-scope button:not(:disabled)');
    $buttons.prop('disabled', true);
    try {
      if (needsConfirm(app.layout)) {
        const accepted = await new Promise((resolve) => bootbox.confirm({
          title: '크기가 다릅니다',
          message: `위 선택은 ${save.next.contextWidth} × ` +
            `${save.next.contextHeight}이고, 이 레이아웃은 ` +
            `${save.previous.contextWidth} × ${save.previous.contextHeight}입니다.` +
            '<br>레이아웃을 위 크기로 바꿀까요?' +
            '<br>영역과 위젯의 위치는 그대로라 화면 밖으로 나갈 수 있습니다.',
          buttons: {
            cancel: {label: '그대로 두기'},
            confirm: {label: '바꾸기', className: 'btn-primary'},
          },
          callback: resolve,
        }));
        if (!accepted) {
          scope.select?.('', false);
          toastr.info('레이아웃은 그대로 두고, 위 선택을 해제했습니다.');
          return;
        }
        if (scope.getDisplayId() !== displayId || !canEdit() || pending()) return;
      }

      const current = buildResolutionSave(
        app.layout, scope.getLayoutDefaults?.() || {});
      if (!current) return;
      app.common.showLoadingScreen();
      try {
        await app.historyManager.addChange(
          'saveForm', 'layout', app.layout.layoutId,
          current.previous, current.next,
        );
        await app.reloadData(app.layout.layoutId, {refreshEditor: true});
        toastr.success('위 선택과 같은 크기로 바꿨습니다.');
      } finally {
        app.common.hideLoadingScreen();
      }
    } catch (error) {
      toastr.error(errorText(error), '', {escapeHtml: true});
    } finally {
      busy = false;
      $buttons.prop('disabled', false);
    }
  }

  app.alignDeviceResolution = function() {
    return align(false);
  };
  $(document).on('deviceScope:change.layoutResolution',
    function(event, displayId, fromUser) {
      align(fromUser === true);
    });
}

module.exports = {bindDeviceResolution, buildResolutionSave, needsConfirm};
