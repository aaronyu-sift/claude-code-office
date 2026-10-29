// Numbers for a locale, taken from Intl instead of a rule per language: the decimal separator ("1,2k" in Turkish, "1.2k" in English) and
// where the percent sign goes ("%12" in Turkish, "12%" in English, "12 %" in French). `pct` keeps the number as given (no rounding).
export function numberFormat(locale) {
  const nf = new Intl.NumberFormat(locale);
  const decimal = nf.formatToParts(1.1).find(p => p.type === 'decimal')?.value ?? '.';
  const pattern = new Intl.NumberFormat(locale, { style: 'percent' }).formatToParts(0.5).map(p => (p.type === 'integer' ? '{n}' : p.value)).join('');
  return {
    num: n => nf.format(n),
    pct: n => pattern.replace('{n}', () => String(n)),
    dec: s => String(s).replace('.', decimal),             // applied to toFixed output
  };
}
