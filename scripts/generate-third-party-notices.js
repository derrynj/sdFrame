const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const rows = [];

for (const [entry, lockedPackage] of Object.entries(lock.packages)) {
  if (!entry.startsWith('node_modules/') || lockedPackage.dev) continue;

  const packageDirectory = path.join(root, entry);
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  const license = lockedPackage.license || packageJson.license || 'Undeclared';
  const licenseFile = fs.readdirSync(packageDirectory)
    .filter((name) => /^(license|licence|copying|notice)(\.|$)/i.test(name))
    .sort((a, b) => {
      const priority = (name) => /^licen[cs]e/i.test(name) ? 0 : /^copying/i.test(name) ? 1 : 2;
      return priority(a) - priority(b) || a.localeCompare(b);
    })[0];

  rows.push({
    name: packageJson.name,
    version: lockedPackage.version,
    license,
    author: typeof packageJson.author === 'string'
      ? packageJson.author
      : packageJson.author?.name || 'Not specified in package metadata',
    licenseText: licenseFile
      ? fs.readFileSync(path.join(packageDirectory, licenseFile), 'utf8').trim()
      : null,
  });
}

rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

for (const row of rows) {
  if (!row.licenseText) {
    console.warn(`${row.name}@${row.version} declares ${row.license} but provides no license text file.`);
  }
}

const escapeTableCell = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\|/g, '\\|');

const lines = [
  '# Third-party notices',
  '',
  'This file lists the production npm dependencies locked for sdFrame and reproduces license files included with those packages. Development-only dependencies are not included in the distributed app.',
  '',
  'The packaged Electron runtime also supplies its own `LICENSE.electron.txt` and `LICENSES.chromium.html` notices alongside the application.',
  '',
  'Regenerate this file after changing production dependencies with `npm run notices`.',
  '',
  '| Package | Version | Declared license | Author / attribution |',
  '| --- | --- | --- | --- |',
  ...rows.map(({ name, version, license, author }) =>
    `| ${name} | ${version} | ${license} | ${escapeTableCell(author)} |`),
  '',
  '## License texts',
  '',
];

for (const row of rows) {
  lines.push(`### ${row.name} ${row.version} — ${row.license}`, '');
  if (row.licenseText) {
    lines.push(row.licenseText, '');
  } else {
    lines.push(
      `The package metadata declares ${row.license}, but the installed npm package does not include a license text file. The package author is listed in the attribution table above.`,
      '',
    );
  }
}

fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), `${lines.join('\n').trimEnd()}\n`);
console.log(`Wrote notices for ${rows.length} production npm packages.`);
