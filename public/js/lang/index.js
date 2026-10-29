// The supported languages, in the order the language list shows them. Add a language here and nothing else in the code changes.
//
// A language is one file in this folder (copy en.js) that exports:
//   code         lower-case language tag: 'en', 'tr', 'de', or with a region when the regions differ: 'pt-BR'
//   name         the language's own name, as its speakers write it ('English', 'Türkçe', 'Deutsch'); the list shows this, never a translation
//   locale       the Intl locale for numbers, plural rules and sorting ('en-US', 'tr-TR', 'de-DE')
//   chooseTitle  "Choose your language" in that language: the list shows every language's title, so a visitor finds theirs
//   messages     key -> text (see i18n.js for the three value forms); a key that is missing falls back to English
//   server       optional: maps the server's fixed Turkish labels to this language (falls back to English's map)
//   serverNative optional: true when those labels already are in this language (Turkish)
// Then add the file to the list below. `npm test` checks the fields, that the name is unique and lists the keys a translation lacks.
import en from './en.js';
import tr from './tr.js';

export const LANGUAGES = [en, tr];
export const FALLBACK = 'en';
