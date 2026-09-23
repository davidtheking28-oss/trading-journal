import { assertEquals } from "jsr:@std/assert";
import { DOMParser as RealDOMParser } from "jsr:@b-fuze/deno-dom";
import { flexParseXML, computeShadowDiff } from "./flex-import.mjs";

// npm:@xmldom/xmldom has no querySelectorAll (flexParseXML's own doc.querySelectorAll
// call throws against it) and deno-dom's parseFromString itself refuses mode
// "text/xml" ("unimplemented") — but its "text/html" mode parses this simple
// attribute-only Flex XML fine and DOES support querySelectorAll. flexParseXML
// hardcodes the 'text/xml' argument internally (by design — it's the browser's
// native DOMParser call, unchanged since Phase 1), so this adapter swallows
// that mismatch here instead of touching the shared module for a Deno-only quirk.
class DenoFlexDOMParser {
  parseFromString(xml: string, _mime: string) {
    return new RealDOMParser().parseFromString(xml, "text/html");
  }
}

Deno.test("flexParseXML runs against the injected deno-dom DOMParser", () => {
  const xml = `<FlexQueryResponse><FlexStatements><FlexStatement>
    <Trades><Trade symbol="AAPL" assetCategory="STK" buySell="BUY"
      dateTime="20260101;103000" quantity="10" tradePrice="150" ibCommission="1"
      tradeID="t1" openCloseIndicator="O" /></Trades>
  </FlexStatement></FlexStatements></FlexQueryResponse>`;
  const out = flexParseXML(xml, DenoFlexDOMParser);
  assertEquals(out.length, 1);
  assertEquals(out[0].symbol, "AAPL");
});

Deno.test("computeShadowDiff reports a trade missing from existing rows", async () => {
  const trade = { symbol: "AAPL", type: "stock", ls: "L", shares: 10,
    entryPrice: 150, entryDate: "2026-01-01", commission: 1, ibkr_id: "t1", closedShares: 0 };
  const result = await computeShadowDiff([trade], []);
  assertEquals(result.imported, 1);
});

Deno.test("computeShadowDiff reports nothing when the trade already exists", async () => {
  const trade = { symbol: "AAPL", type: "stock", ls: "L", shares: 10,
    entryPrice: 150, entryDate: "2026-01-01", commission: 1, ibkr_id: "t1", closedShares: 0, deleted: false };
  const result = await computeShadowDiff([trade], [trade]);
  assertEquals(result.imported, 0);
  assertEquals(result.updated, 0);
});

Deno.test("ibkr-import never writes to the trades table while in shadow mode", async () => {
  const src = await Deno.readTextFile(
    new URL("../ibkr-import/index.ts", import.meta.url),
  );
  const hasTradesWrite = /\.from\(["']trades["']\)\s*\.\s*(insert|update|upsert|delete)/.test(src);
  if (hasTradesWrite) {
    throw new Error(
      "ibkr-import writes to trades — this must stay log-only until Phase 4 cutover is explicitly approved",
    );
  }
});
