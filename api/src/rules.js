// This is the deterministic "flags engine" for cleaning products.

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function hasAny(text, terms) {
  const t = norm(text);
  return terms.some((x) => t.includes(x));
}

function listHasAny(list, terms) {
  const joined = (Array.isArray(list) ? list : []).map(norm).join(" | ");
  return hasAny(joined, terms);
}

function addFlag(flags, id, title, reason, level = "caution") {
  flags.push({ id, title, reason, level });
}

export function scoreCleaningProduct(product, preferences = {}) {
  const flags = [];
  const handlingTips = [];

  const name = norm(product?.name_guess);
  const ingredientsRaw = norm(product?.ingredients_raw);
  const ingredientsList = Array.isArray(product?.ingredients_list) ? product.ingredients_list : [];
  const warnings = Array.isArray(product?.warnings) ? product.warnings : [];
  const warningsText = warnings.map(norm).join(" | ");

  const allText = [name, ingredientsRaw, ingredientsList.join(" "), warningsText].join(" | ");

  // Preferences defaults for MVP
  const prefs = {
    fragranceFree: preferences?.fragranceFree ?? true,
    bleachFree: preferences?.bleachFree ?? false,
    ammoniaFree: preferences?.ammoniaFree ?? false,
    avoidQuats: preferences?.avoidQuats ?? false,
    sensitiveMode: preferences?.sensitiveMode ?? false
  };

  // 1) Fragrance
  if (prefs.fragranceFree && hasAny(allText, ["fragrance", "parfum", "perfume"])) {
    addFlag(
      flags,
      "contains_fragrance",
      "Contains fragrance",
      "Fragrance can be irritating for sensitive users. Consider fragrance free alternatives.",
      "info"
    );
  }

  // 2) Bleach
  const bleachTerms = ["sodium hypochlorite", "hypochlorite", "chlorine bleach", "bleach"];
  if (prefs.bleachFree && hasAny(allText, bleachTerms)) {
    addFlag(
      flags,
      "contains_bleach",
      "Contains chlorine bleach",
      "Bleach is effective but can be harsh and can form harmful gases if mixed with acids or ammonia.",
      "caution"
    );
    handlingTips.push("Never mix bleach with acids (vinegar) or ammonia. Ventilate well.");
  }

  // 3) Ammonia
  const ammoniaTerms = ["ammonia", "ammonium hydroxide"];
  if (prefs.ammoniaFree && hasAny(allText, ammoniaTerms)) {
    addFlag(
      flags,
      "contains_ammonia",
      "Contains ammonia",
      "Ammonia can be irritating and should never be mixed with bleach.",
      "caution"
    );
    handlingTips.push("Never mix ammonia with bleach. Ventilate well.");
  }

  // 4) Quats
  const quatTerms = [
    "benzalkonium chloride",
    "didecyldimethylammonium chloride",
    "alkyl dimethyl benzyl ammonium chloride",
    "quat"
  ];
  if (prefs.avoidQuats && hasAny(allText, quatTerms)) {
    addFlag(
      flags,
      "contains_quats",
      "Contains quaternary ammonium compounds",
      "Some people prefer to avoid quats due to sensitivity concerns and residues on surfaces.",
      "info"
    );
  }

  // 5) Corrosive warnings
  if (hasAny(warningsText, ["corrosive", "causes burns", "severe skin burns", "eye damage"])) {
    addFlag(
      flags,
      "corrosive_warning",
      "Corrosive or burn warning",
      "Label indicates corrosive risk. Use gloves and avoid contact with skin and eyes.",
      "caution"
    );
    handlingTips.push("Use gloves. Avoid splashes. Keep away from children and pets.");
  }

  // 6) Strong alkali / lye
  if (hasAny(allText, ["sodium hydroxide", "lye", "caustic"])) {
    addFlag(
      flags,
      "strong_alkali",
      "Strong alkaline ingredient",
      "Strong alkalis can cause burns and should be handled carefully.",
      "caution"
    );
    handlingTips.push("Avoid contact. Rinse thoroughly. Store securely.");
  }

  // 7) Strong acids
  if (hasAny(allText, ["hydrochloric acid", "muriatic", "sulfuric acid", "phosphoric acid"])) {
    addFlag(
      flags,
      "strong_acid",
      "Strong acid ingredient",
      "Strong acids can cause burns and release fumes. Use with ventilation.",
      "caution"
    );
    handlingTips.push("Ventilate well. Avoid mixing with bleach.");
  }

  // 8) Solvents (simple starter)
  if (hasAny(allText, ["2-butoxyethanol", "glycol ether", "solvent"])) {
    addFlag(
      flags,
      "solvent_based",
      "Solvent based cleaner",
      "Solvents can be irritating. Consider low odor or soap based alternatives if sensitive.",
      "info"
    );
    if (prefs.sensitiveMode) handlingTips.push("Ventilate well and avoid prolonged exposure.");
  }

  // 9) Aerosol indicator
  if (hasAny(allText, ["aerosol", "propellant", "pressurized"])) {
    addFlag(
      flags,
      "aerosol",
      "Aerosol product",
      "Aerosols can increase inhalation exposure. Consider pump sprays or liquids.",
      "info"
    );
  }

  // Overall bucket for UI
  let overall = "keep";
  if (flags.some((f) => f.level === "caution")) overall = "use_with_care";
  if (flags.length >= 3 && flags.some((f) => f.id.includes("corrosive") || f.id.includes("strong_"))) {
    overall = "consider_swap";
  }

  return { flags, handlingTips, overall };
}