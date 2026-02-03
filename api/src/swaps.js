// Swap suggestions based on flags, MVP version.

export function getSwapSuggestions(scored, preferences = {}) {
  const flags = Array.isArray(scored?.flags) ? scored.flags : [];
  const ids = new Set(flags.map((f) => f.id));

  const suggestions = [];

  // Generic patterns first
  if (ids.has("contains_bleach")) {
    suggestions.push({
      title: "Oxygen based cleaner (non chlorine)",
      why: "Often effective for whitening and stain removal without chlorine bleach.",
      type: "pattern"
    });
    suggestions.push({
      title: "Hydrogen peroxide bathroom cleaner",
      why: "Good for bathrooms, with less harsh fumes for many users.",
      type: "pattern"
    });
  }

  if (ids.has("contains_fragrance")) {
    suggestions.push({
      title: "Fragrance free all purpose cleaner",
      why: "Reduces scent exposure for sensitive users.",
      type: "pattern"
    });
    suggestions.push({
      title: "Fragrance free dish soap or laundry detergent",
      why: "Cuts fragrance across common sources.",
      type: "pattern"
    });
  }

  if (ids.has("aerosol")) {
    suggestions.push({
      title: "Pump spray alternative",
      why: "Less airborne mist than aerosols.",
      type: "pattern"
    });
  }

  if (ids.has("contains_quats")) {
    suggestions.push({
      title: "Soap based cleaner",
      why: "Good everyday option if you prefer to avoid quats.",
      type: "pattern"
    });
  }

  if (ids.has("strong_acid") || ids.has("strong_alkali") || ids.has("corrosive_warning")) {
    suggestions.push({
      title: "Milder pH cleaner for routine use",
      why: "Use strong products only when needed, keep routine cleaning gentler.",
      type: "pattern"
    });
  }

  // Always include a neutral baseline suggestion
  suggestions.push({
    title: "Microfiber cloth + warm soapy water",
    why: "Often sufficient for many surfaces and reduces chemical load.",
    type: "pattern"
  });

  // Trim for MVP UI
  return suggestions.slice(0, 4);
}