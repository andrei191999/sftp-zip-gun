const path = require('path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 120000,
  });

  mocha.addFile(path.join(__dirname, 'quickUpload.smoke.js'));

  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} smoke test(s) failed.`));
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  run,
};
