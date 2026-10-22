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
  return error?.message || error?.errorThrown || '레이아웃 크기를 바꾸지 못했습니다.';
}

function sizeText(width, height) {
  return `${width} × ${height}`;
}

function displayLabel(scope) {
  const name = scope?.getDisplay?.()?.display;
  return name ? `${name} 디스플레이` : '위쪽 디스플레이';
}

// Closing the dialog is not a choice. Only the buttons change anything.
function dialogResultAction(result) {
  if (result === true) return 'resize';
  if (result === false) return 'clear';
  return 'keep';
}

function askToResize(save) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const layoutSize = sizeText(
      save.previous.contextWidth, save.previous.contextHeight);
    const displaySize = sizeText(
      save.next.contextWidth, save.next.contextHeight);
    bootbox.dialog({
      title: '레이아웃 크기를 바꿀까요?',
      message: `${displayLabel(window.deviceScope)}는 ${displaySize}입니다.` +
        `<br>이 레이아웃은 ${layoutSize}입니다.` +
        `<br><br>크기 바꾸기: 레이아웃을 ${displaySize}로 바꿉니다. ` +
        '이미 넣은 내용은 줄어들지 않아서 화면 밖으로 나갈 수 있습니다.' +
        `<br>레이아웃 유지: 레이아웃은 ${layoutSize}로 두고, ` +
        '위쪽 디스플레이 선택은 전체로 해제합니다.',
      onEscape: () => finish(null),
      buttons: {
        cancel: {
          label: '레이아웃 유지',
          callback: () => finish(false),
        },
        confirm: {
          label: '크기 바꾸기',
          className: 'btn-primary',
          callback: () => finish(true),
        },
      },
    }).one('hidden.bs.modal', () => finish(null));
  });
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
      const layoutSize = sizeText(
        save.previous.contextWidth, save.previous.contextHeight);
      const displaySize = sizeText(
        save.next.contextWidth, save.next.contextHeight);
      let reason = '이 레이아웃은 발행된 상태라 바로 수정되지 않습니다. ' +
        '화면의 Checkout 버튼을 눌러 편집을 시작한 뒤에 크기를 바꿀 수 있습니다.';
      if (app.editorContainer.hasClass('locked-for-user')) {
        reason = '다른 사람이 편집 중이라 지금은 레이아웃 크기를 바꿀 수 없습니다.';
      } else if (app.interactiveMode || app.interactiveEditWidgetMode) {
        reason = 'Interactive Mode를 끝낸 뒤에 레이아웃 크기를 바꿀 수 있습니다.';
      }
      toastr.info(
        `${displayLabel(scope)}는 ${displaySize}입니다. ` +
        `이 레이아웃은 ${layoutSize}입니다. ${reason}`);
      return;
    }
    if (pending()) {
      if (fromUser) {
        toastr.info(
          '저장하지 않은 수정이 있습니다. 저장하거나 취소한 뒤, 위쪽 디스플레이를 다시 눌러 주세요.');
      }
      return;
    }

    busy = true;
    handled = key;
    const $buttons = $('#device-scope button:not(:disabled)');
    $buttons.prop('disabled', true);
    try {
      if (needsConfirm(app.layout)) {
        const action = dialogResultAction(await askToResize(save));
        if (action === 'keep') return;
        if (action === 'clear') {
          scope.select?.('', false);
          toastr.info(
            `레이아웃 크기는 ${sizeText(save.previous.contextWidth, save.previous.contextHeight)} 그대로입니다. ` +
            '위쪽 디스플레이 선택은 전체로 해제했습니다.');
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
        toastr.success(
          `레이아웃 크기를 ${sizeText(current.next.contextWidth, current.next.contextHeight)}로 바꿨습니다.`);
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

module.exports = {
  bindDeviceResolution, buildResolutionSave, needsConfirm, dialogResultAction,
};
