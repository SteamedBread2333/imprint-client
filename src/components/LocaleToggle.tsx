import type { Locale, t } from "../i18n";

type Props = {
  locale: Locale;
  onChange: (l: Locale) => void;
  m: ReturnType<typeof t>;
};

export function LocaleToggle({ locale, onChange, m }: Props) {
  return (
    <div className="locale-toggle">
      <button
        type="button"
        className={locale === "zh" ? "btn small active-lang" : "btn ghost small"}
        onClick={() => onChange("zh")}
      >
        {m.langZh}
      </button>
      <button
        type="button"
        className={locale === "en" ? "btn small active-lang" : "btn ghost small"}
        onClick={() => onChange("en")}
      >
        {m.langEn}
      </button>
    </div>
  );
}
