/* ==========================================================================
   AI Buildout Atlas: site navigation manifest (nav.js)
   --------------------------------------------------------------------------
   atlas.js builds the sidebar, the top-bar breadcrumb and the prev/next
   pager from this object. It is a plain script (not JSON) so it works when
   pages are opened straight from disk (file://), where fetch() is blocked.

   HOW TO REGISTER A PAGE
   - Every href is relative to the docs/ root. atlas.js prefixes it with the
     page's <html data-root="..."> value ("" for docs/*.html, "../" for
     docs/western/*.html and docs/china/*.html).
   - A page highlights itself in the sidebar via <html data-page="W05">
     (use the item's id).
   - status:
       "live"    linked, no tag (page is published and QA'd)
       "draft"   linked, with a small "Draft" tag
       "planned" listed but NOT linked, with a "Soon" tag
     When you ship a page, flip its status to "live" (or "draft").
   - The pager (prev/next) walks the items of the current track in order,
     skipping "planned" items.
   - Keep the layer IDs stable. China mirrors Western with a C prefix.
   ========================================================================== */
window.ATLAS_NAV = {
  site: {
    title: "AI Buildout Atlas",
    home: "index.html",
    tagline: "From electrons to agents: how the AI build-out works and where the money goes."
  },

  tracks: [
    {
      id: "western",
      title: "Western build-out",
      short: "Western",
      items: [
        { id: "W00", title: "Overview",                 href: "western/W00-overview.html",            status: "live", dek: "The stack, the money map, the story" },
        { id: "W01", title: "Demand & capex",           href: "western/W01-demand-capex.html",        status: "live", dek: "Who is spending, how much, on what" },
        { id: "W02", title: "Capital & financing",      href: "western/W02-capital-financing.html",   status: "live", dek: "Where the money comes from" },
        { id: "W03", title: "Energy & power",           href: "western/W03-energy-power.html",        status: "live", dek: "Electrons, grids and the power bottleneck" },
        { id: "W04", title: "Data centers",             href: "western/W04-datacenters.html",         status: "live", dek: "Developers, REITs, construction, power and cooling" },
        { id: "W05", title: "Compute silicon",          href: "western/W05-compute-silicon.html",     status: "live", dek: "GPUs, custom ASICs, CPUs, accelerators" },
        { id: "W06", title: "Semiconductor supply chain", href: "western/W06-semi-supply-chain.html", status: "live", dek: "Foundry, packaging, HBM, equipment, EDA" },
        { id: "W07", title: "Networking & systems",     href: "western/W07-networking-systems.html",  status: "live", dek: "Switches, optics, servers and racks" },
        { id: "W08", title: "Cloud",                    href: "western/W08-cloud.html",               status: "live", dek: "Hyperscalers and neoclouds" },
        { id: "W09", title: "Model labs",               href: "western/W09-model-labs.html",          status: "live", dek: "Frontier and open-weight labs" },
        { id: "W10", title: "Applications & agents",    href: "western/W10-apps-agents.html",         status: "live", dek: "Where end-customer money enters" },
        { id: "W11", title: "Synthesis",                href: "western/W11-synthesis.html",           status: "live", dek: "Money flow, profit pools, risks, scenarios" }
      ]
    },
    {
      id: "china",
      title: "China build-out",
      short: "China",
      note: "Coming soon. Same layer IDs with a C prefix, so the two tracks compare line by line.",
      items: [
        { id: "C00", title: "Overview",                 href: "china/C00-overview.html",            status: "planned" },
        { id: "C01", title: "Demand & capex",           href: "china/C01-demand-capex.html",        status: "planned" },
        { id: "C02", title: "Capital & financing",      href: "china/C02-capital-financing.html",   status: "planned" },
        { id: "C03", title: "Energy & power",           href: "china/C03-energy-power.html",        status: "planned" },
        { id: "C04", title: "Data centers",             href: "china/C04-datacenters.html",         status: "planned" },
        { id: "C05", title: "Compute silicon",          href: "china/C05-compute-silicon.html",     status: "planned" },
        { id: "C06", title: "Semiconductor supply chain", href: "china/C06-semi-supply-chain.html", status: "planned" },
        { id: "C07", title: "Networking & systems",     href: "china/C07-networking-systems.html",  status: "planned" },
        { id: "C08", title: "Cloud",                    href: "china/C08-cloud.html",               status: "planned" },
        { id: "C09", title: "Model labs",               href: "china/C09-model-labs.html",          status: "planned" },
        { id: "C10", title: "Applications & agents",    href: "china/C10-apps-agents.html",         status: "planned" },
        { id: "C11", title: "Synthesis",                href: "china/C11-synthesis.html",           status: "planned" }
      ]
    }
  ],

  reference: {
    title: "Reference",
    items: [
      { id: "glossary",    title: "Glossary",           href: "glossary.html",    status: "live" },
      { id: "companies",   title: "Company directory",  href: "companies.html",   status: "live" },
      { id: "timeline",    title: "Timeline",           href: "timeline.html",    status: "live" },
      { id: "sources",     title: "Sources",            href: "sources.html",     status: "live" },
      { id: "methodology", title: "Methodology",        href: "methodology.html", status: "live" },
      { id: "style-guide", title: "Design system",      href: "style-guide.html", status: "live" }
    ]
  }
};
