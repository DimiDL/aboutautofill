ChromeUtils.defineESModuleGetters(this, {
  WebNavigationFrames: "resource://gre/modules/WebNavigationFrames.sys.mjs",
});

function getActorByTabId(tabId, tabManager) {
  const { browser } = tabManager.get(tabId);
  const windowGlobal = browser.browsingContext.currentWindowGlobal;
  return windowGlobal?.getActor("FormAutofill");
}

this.autofill = class extends ExtensionAPI {
  getAPI(context) {
    const { tabManager } = context.extension;

    return {
      experiments: {
        autofill: {
          // TODO: Explain why we need this CaptureTab. V3 Doesn't have this
          async captureTab(tabId, x, y, width, height) {
            // Copied from https://searchfox.org/mozilla-central/rev/4e69784010d271c0fce0927442e4f8e66ffe645b/toolkit/components/extensions/parent/ext-tabs-base.js#112
            const { browser } = tabManager.get(tabId);

            const zoom = browser.browsingContext.fullZoom;
            const scale = browser.browsingContext.topChromeWindow.devicePixelRatio || 1;
            const rect = new context.xulBrowser.ownerGlobal.window.DOMRect(x, y, width, height);

            const wgp = browser.browsingContext.currentWindowGlobal;
            const image = await wgp.drawSnapshot(
              rect,
              scale * zoom,
              "white"
            );

            const canvas = new OffscreenCanvas(image.width, image.height);

            const ctx = canvas.getContext("bitmaprenderer", { alpha: false });
            ctx.transferFromImageBitmap(image);

            const blob = await canvas.convertToBlob({
              type: `image/png`,
            });

            const dataURL = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
            return dataURL;
          },

          async inspect(tabId, changes) {
            console.log("inspect with changes" + JSON.stringify(changes));
            const actor = getActorByTabId(tabId, tabManager);

            const forms = await actor.inspectFields(changes);

            const fieldDetails = [];
            const bcs = actor.browsingContext.getAllBrowsingContextsInSubtree();
            for (const form of forms) {
              const formIndex = forms.indexOf(form);
              for (const section of form) {
                const sectionIndex = form.indexOf(section);
                section.fieldDetails.forEach(fd => fd.formIndex = formIndex);
                section.fieldDetails.forEach(fd => fd.sectionIndex = sectionIndex);

                for (const fieldDetail of section.fieldDetails) {
                  const bc = bcs.find(bc => bc.id == fieldDetail.browsingContextId);
                  const host = bc.currentWindowGlobal.documentPrincipal.host;

                  fieldDetail.frameId = WebNavigationFrames.getFrameId(bc);

                  if (!bc || bc == bc.top) {
                    fieldDetail.frame = `(M) ${host}`;
                  } else if (bc.currentWindowGlobal.documentPrincipal.equals(
                      bc.top.currentWindowGlobal.documentPrincipal)) {
                    fieldDetail.frame = `(S) ${host}`;
                  } else {
                    fieldDetail.frame = `(C) ${host}`;
                  }
                }
                fieldDetails.push(...section.fieldDetails);
              }
            }

            return fieldDetails;
          },

          async setTestRecords(tabId, records) {
            const actor = getActorByTabId(tabId, tabManager);

            await actor.setTestRecords(records);
          },
        },
      },
    };
  }
};
