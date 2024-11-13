browser.devtools.panels
  .create(
    "Autofill", // title
    "./icons/icon.svg", // icon
    "./devtools-panel.html", // content
  )
  .then((newPanel) => {
    newPanel.onShown.addListener(panelShown);
    newPanel.onHidden.addListener(panelHidden);
  });


function panelShown() {
  //browser.runtime.sendMessage({
    //msg: "show",
    //tabId: browser.devtools.inspectedWindow.tabId,
  //});
}

function panelHidden() {
  //browser.runtime.sendMessage({
    //msg: "hide",
    //tabId: browser.devtools.inspectedWindow.tabId,
  //});
}
