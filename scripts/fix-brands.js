// One-time cleanup: the PPK scrape's `item_brand` field often held the name
// of whatever collection/listicle page a product was tagged on ("Best
// Wireless Earbuds", "Ksh 25000 to Ksh 30000", "Anker Bluetooth Speakers")
// rather than an actual brand. This recomputes `brand` from the clean
// `name` field via keyword matching, for PPK-imported rows only (SKU
// prefix "PPK-") — the original Mogo catalogue rows already have correct
// brands and are left untouched. Rows with no recognizable brand keyword
// are set to NULL (the UI already falls back to showing the category).
//
//   npm run fix-brands -- --dry-run
//   npm run fix-brands
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";

const { values: args } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const DRY = args["dry-run"];

// Ordered: more specific / multi-word patterns first so they win over
// generic ones (e.g. "Google Pixel" before a bare "Google").
const RULES = [
  [/\biPhone\b|\biPad\b|\bMacBook\b|\bAirPods\b|\bEarPods\b|\bApple\b/i, "Apple"],
  [/\bGalaxy\b|\bSamsung\b/i, "Samsung"],
  [/\bPS5\b|\bPS4\b|\bPlayStation\b|\bDualSense\b|\bDualShock\b/i, "PlayStation"],
  [/\bXbox\b/i, "Xbox"],
  [/\bGoogle Pixel\b|\bGoogle\b/i, "Google"],
  [/\bNintendo\b/i, "Nintendo"],
  [/\bSoundcore\b|\bAnker\b/i, "Anker"],
  [/\boraimo\b/i, "oraimo"],
  [/\bPorodo\b/i, "Porodo"],
  [/\bOnePlus\b|\bOneplus\b/i, "OnePlus"],
  [/\bInfinix\b|\bXPAD\b/i, "Infinix"],
  [/\bMegapad\b|\bTecno\b|\bCamon\b|\bPova\b/i, "Tecno"],
  [/\bSanDisk\b/i, "SanDisk"],
  [/\bRedmi\b/i, "Redmi"],
  [/\bXiaomi\b|\bPoco\b/i, "Xiaomi"],
  [/\bCMF\b|\bNothing\b/i, "Nothing"],
  [/\bSony\b/i, "Sony"],
  [/\bMotorola\b/i, "Motorola"],
  [/\bOppo\b/i, "Oppo"],
  [/\bHollyland\b/i, "Hollyland"],
  [/\bVivo\b/i, "Vivo"],
  [/\bInsta360\b/i, "Insta360"],
  [/\bRay-Ban\b/i, "Ray-Ban"],
  [/\bAmazon\b|\bKindle\b|\bFire HD\b/i, "Amazon"],
  [/\bitel\b|\bA6X?\b|\bA3X\b|\bA5\b/i, "Itel"],
  [/\bMicrosoft\b|\bSurface\b/i, "Microsoft"],
  [/\brealme\b/i, "realme"],
  [/\bLogitech\b/i, "Logitech"],
  [/\bBose\b/i, "Bose"],
  [/\bAmazfit\b/i, "Amazfit"],
  [/\bHonor\b/i, "Honor"],
  [/\bElimuTab\b/i, "ElimuTab"],
  [/\bHuawei\b/i, "Huawei"],
  [/\bLenovo\b/i, "Lenovo"],
  [/\bAsus\b/i, "Asus"],
  [/\breMarkable\b/i, "reMarkable"],
  [/\bGreen Lion\b/i, "Green Lion"],
  [/\bBeats\b|\bPowerbeats\b/i, "Beats"],
  [/\bMoxom\b/i, "Moxom"],
  [/\bSkullcandy\b/i, "Skullcandy"],
  [/\bSeagate\b/i, "Seagate"],
  [/\bWD\b|\bWestern Digital\b/i, "WD"],
  [/\bPromate\b/i, "Promate"],
  [/\bMeta Quest\b|\bMeta\b/i, "Meta"],
  [/\bVisionPlus\b/i, "VisionPlus"],
  [/\bHarman\b/i, "Harman Kardon"],
  [/\bFitbit\b/i, "Fitbit"],
  [/\bHot\b/i, "Infinix"],
  [/\bnubia\b/i, "nubia"],
  [/\bZTE\b/i, "ZTE"],
  [/\bHMD\b/i, "HMD"],
  [/\bNokia\b/i, "Nokia"],
  [/\bGoPro\b/i, "GoPro"],
  [/\bToshiba\b/i, "Toshiba"],
  [/\bTranscend\b/i, "Transcend"],
  [/\bWinro\b/i, "Winro"],
  [/\bX-TIGI\b/i, "X-TIGI"],
  [/\bVerbatim\b/i, "Verbatim"],
  [/\bCOTECI\b/i, "COTECI"],
  [/\bTelzeal\b/i, "Telzeal"],
  [/\bModio\b/i, "Modio"],
  [/\bBontel\b/i, "Bontel"],
  [/\bonn\.\b/i, "onn."],
  [/\bWHOOP\b/i, "Whoop"],
  [/\bUltrahuman\b/i, "Ultrahuman"],
  [/\bThrustmaster\b/i, "Thrustmaster"],
  [/\bTurtle Beach\b/i, "Turtle Beach"],
  [/\bPowerA\b/i, "PowerA"],
  [/\bBackbone\b/i, "Backbone"],
  [/\bDJI\b/i, "DJI"],
  [/\bJBL\b/i, "JBL"],
];

function guessBrand(name) {
  for (const [re, brand] of RULES) {
    if (re.test(name)) return brand;
  }
  return null;
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.db);
  try {
    const [rows] = await pool.query("SELECT id, sku, brand, name FROM products WHERE sku LIKE 'PPK-%'");
    let changed = 0;
    let clearedToNull = 0;
    for (const row of rows) {
      const guessed = guessBrand(row.name);
      if (guessed === row.brand) continue;
      changed++;
      if (guessed === null) clearedToNull++;
      if (DRY) {
        console.log(`  ${row.sku.padEnd(14)} ${(row.brand ?? "∅").padEnd(28)} -> ${guessed ?? "∅"}   ${row.name}`);
      } else {
        await pool.query("UPDATE products SET brand = ? WHERE id = ?", [guessed, row.id]);
      }
    }
    console.log(`\n${DRY ? "[dry run] " : ""}checked: ${rows.length}  changed: ${changed}  cleared to null: ${clearedToNull}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
