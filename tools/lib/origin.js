// Who drew it. One implementation, because two would disagree rather than fail
// — the same reasoning that put PALETTE_SIZE in format.js.
//
// This decides what may leave the repo. build_editor_samples.js --public uses
// it to keep third-party art off the hosted editor; export_upstream.js uses it
// to keep the same art out of a header handed to a stranger to compile. Those
// are both distributions in a way that a repo someone chooses to clone is not.
//
// Origin is decided by whether the NAME appears in a third-party source dir,
// wherever the winning file lives. A claudepix animation that was edited here
// has a copy in drawn_anims/, and drawn_anims/ wins the load order — so
// labelling by winning directory would file it under "drawn for this project".
// For `idle look around` that copy is byte-identical to the scrape. Calling it
// ours because of where the file sits is exactly the laundering this label
// exists to prevent.
//
// custom_anims/ counts as claudepix too: make_custom_anims.js does not draw
// characters, it poses an existing claudepix animation and lays props over it.
// The props are ours; what they are riding is not.
'use strict';

const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..');

const namesIn = (dir) => {
  const d = path.join(TOOLS, dir);
  if (!fs.existsSync(d)) return new Set();
  return new Set(fs.readdirSync(d)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).name; }
                catch { return null; } })
    .filter(Boolean));
};

// Built once per process: the source dirs do not change under a running tool.
let cache = null;
const sets = () => (cache ||= {
  claudepix: namesIn('claudepix_data'),
  custom:    namesIn('custom_anims'),
  official:  namesIn('official_anims'),
});

// 'claudepix'  scraped from claudepix.vercel.app
// 'claudepix+' claudepix frames with props drawn here
// 'official'   Anthropic's own art, imported by import_official.js
// 'drawn'      drawn here, from an empty grid
function originOf(name) {
  const s = sets();
  return s.custom.has(name)    ? 'claudepix+' :
         s.claudepix.has(name) ? 'claudepix'  :
         s.official.has(name)  ? 'official'   :
                                 'drawn';
}

// claudepix states no licence and its author's account has been unreachable
// since 2026-08-15, so there is nobody to ask. Unreachable is not permission —
// the exclusion is what you do when you cannot ask, and it is reversible the
// day that changes. See tools/README.md § License note.
const THIRD_PARTY = new Set(['claudepix', 'claudepix+']);

module.exports = { namesIn, originOf, THIRD_PARTY };
