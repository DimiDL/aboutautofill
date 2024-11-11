
const url = browser.runtime.getURL("./data/libs/freeze-dry.es.js");
import(url).then(async module => {
  const html = await module.freezeDry(document, {});
  browser.runtime.sendMessage({
    msg: "freeze-complete",
    result: html
  });
});

