import { RFZ_PUBLIC_ASSETS } from '@/lib/storefrontAssets';

export default function RunfazoneLogo({ className = '' }: { className?: string }) {
  return (
    <span aria-label="RunFazone" className={`inline-flex items-center ${className}`}>
      <img src={RFZ_PUBLIC_ASSETS.logo} alt="" aria-hidden="true" className="h-9 w-auto max-w-[10rem] object-contain" />
    </span>
  );
}
