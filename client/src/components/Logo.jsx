// App logo — the suited avocado mascot. Same art as the favicon
// (public/icon-512.png is a head crop of the full public/logo.png).
// Pass `full` to render the whole figure (suit and all) instead of the round head badge.
import { useTranslation } from 'react-i18next';

export default function Logo({ size = 64, className, full = false }) {
  const { t } = useTranslation();
  return (
    <img
      src={full ? '/logo.png' : '/icon-512.png'}
      width={size}
      height={size}
      className={className}
      alt={t('logo.alt')}
      style={{
        display: 'block',
        objectFit: 'cover',
        borderRadius: full ? 'var(--r-lg, 14px)' : '50%',
      }}
    />
  );
}
