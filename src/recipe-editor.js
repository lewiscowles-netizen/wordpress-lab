import { parseDocument } from 'yaml';

// Edit only selected fields. YAML comments, plugin sources and unrelated keys
// survive changes made in the visual controls.
export function editRecipe(text, changes) {
  const document = parseDocument(text, { uniqueKeys: true, maxAliasCount: 0 });
  if (document.errors.length || document.warnings.length) throw new Error('Fix the YAML syntax before using the settings controls.');
  document.toJS({ maxAliasCount: 0 });
  for (const [keys, value] of changes) {
    if (value === undefined) document.deleteIn(keys);
    else document.setIn(keys, value);
  }
  return document.toString({ lineWidth: 0 });
}
