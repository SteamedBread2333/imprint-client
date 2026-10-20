import { LocaleToggle } from "./LocaleToggle";
import type { Locale, t } from "../i18n";

type Props = {
  title: string;
  subtitle?: string;
  locale: Locale;
  onLocale: (l: Locale) => void;
  m: ReturnType<typeof t>;
};

export function Header({ title, subtitle, locale, onLocale, m }: Props) {
  return (
    <header className="app-header">
      <div className="app-header-brand">
        <span className="app-header-title">{title}</span>
        {subtitle && <span className="app-header-sub">{subtitle}</span>}
      </div>
      <LocaleToggle locale={locale} onChange={onLocale} m={m} />
    </header>
  );
}
