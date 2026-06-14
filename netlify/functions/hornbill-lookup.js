// netlify/functions/hornbill-lookup.js
// Thin server-side proxy so the API key never reaches the browser, and CORS is handled.
// Deploy with Netlify. Set env vars in Site settings → Environment:
//   HORNBILL_INSTANCE = yourinstanceid
//   HORNBILL_API_KEY  = <ESP API key generated in Hornbill Admin → API Keys>
// The API key takes on the permissions of the account it was generated under, so
// generate it under a service account with read access to the Asset entity
// (data:entityBrowseRecords2). For the bulk-update path you also need data:entityUpdateRecord.

exports.handler = async (event) => {
  const cors = {
    // Tighten this to your own domain once you're past PoC.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "POST only" }) };

  const instance = process.env.HORNBILL_INSTANCE;
  const apiKey   = process.env.HORNBILL_API_KEY;
  const endpoint = `https://api.hornbill.com/${instance}/xmlmc/data/`;

  try {
    const { tag, matchField = "h_asset_tag", maxResults = 2 } = JSON.parse(event.body || "{}");
    if (!tag) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Missing tag" }) };

    const payload = {
      "@service": "data",
      "@method": "entityBrowseRecords2",
      params: {
        application: "com.hornbill.servicemanager",
        entity: "Asset",
        matchScope: "all",
        // searchColumnType shape: verify against data::entityGetBrowseMetaData for your instance.
        // matchType "exact" for a barcode; use "contains" if your tags are partial.
        searchFilter: [{ column: matchField, value: String(tag), matchType: "exact" }],
        maxResults,
      },
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `ESP-APIKEY ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    // Hornbill JSON responses nest results under params.rowData.row (object if one row, array if many).
    const rowData = data && data.params && data.params.rowData ? data.params.rowData.row : null;
    const rows = Array.isArray(rowData) ? rowData : rowData ? [rowData] : [];

    const matches = rows.map((r) => ({
      assetId: r.h_pk_asset_id,
      name: r.h_name,
      type: r.h_type,
      tag: r.h_asset_tag,
    }));

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ matches, raw: data["@status"] === false ? data : undefined }),
    };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: String(e) }) };
  }
};
