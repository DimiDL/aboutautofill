
const url = browser.runtime.getURL("./data/libs/freeze-dry.es.js");
console.log("[Dimi]Content-Script " + url + "!!!\n");
//import freezeDry from './libs/freeze-dry.es.js'
import(url).then(async module => {
  //dump("[Dimi]run freeze>>" + module + "\n");
  console.log("[Dimi]run freeze >>");
  const html = await module.freezeDry(document, {});
  //console.log("[Dimi]run freeze <<" + html + "");
  //dump("[Dimi]run freeze get " + html + "\n");
  browser.runtime.sendMessage({
    msg: "freeze-complete",
    result: html
  });
});

