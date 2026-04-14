const ALERT_TYPES = {
  NOTE: "note",
  IMPORTANT: "important",
  TIP: "tip",
  WARNING: "warning",
  CAUTION: "caution",
};

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function upgradeAdmonitions() {
  for (const blockquote of document.querySelectorAll(".markdown-body blockquote")) {
    const firstParagraph = blockquote.querySelector("p");
    if (!firstParagraph) {
      continue;
    }

    const text = firstParagraph.textContent.trim();
    const match = text.match(/^\[!(NOTE|IMPORTANT|TIP|WARNING|CAUTION)\]\s*([\s\S]*)$/);
    if (!match) {
      continue;
    }

    const [, label, remainder] = match;
    const callout = document.createElement("aside");
    callout.className = `cockpit-openshift-callout is-${ALERT_TYPES[label]}`;

    const title = document.createElement("span");
    title.className = "cockpit-openshift-callout-title";
    title.textContent = label;
    callout.appendChild(title);

    if (remainder) {
      firstParagraph.textContent = remainder;
    } else {
      firstParagraph.remove();
    }

    while (blockquote.firstChild) {
      callout.appendChild(blockquote.firstChild);
    }

    blockquote.replaceWith(callout);
  }
}

function buildPageToc() {
  const tocRoot = document.getElementById("cockpit-openshift-toc-list");
  const tocWrapper = document.getElementById("cockpit-openshift-page-toc");
  if (!tocRoot || !tocWrapper) {
    return;
  }

  const headings = [...document.querySelectorAll(".markdown-body h2")];
  if (!headings.length) {
    return;
  }

  const usedIds = new Set(
    [...document.querySelectorAll("[id]")].map((element) => element.id),
  );

  for (const heading of headings) {
    if (!heading.id) {
      const baseId = slugifyHeading(heading.textContent);
      let nextId = baseId;
      let suffix = 2;

      while (usedIds.has(nextId)) {
        nextId = `${baseId}-${suffix}`;
        suffix += 1;
      }

      heading.id = nextId;
      usedIds.add(nextId);
    }

    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent.trim();
    item.appendChild(link);
    tocRoot.appendChild(item);
  }

  tocWrapper.hidden = false;
}

function startDocs() {
  upgradeAdmonitions();
  buildPageToc();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startDocs, { once: true });
} else {
  startDocs();
}
