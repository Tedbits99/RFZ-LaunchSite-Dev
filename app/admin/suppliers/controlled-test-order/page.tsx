import ControlledTestOrderClient from './ControlledTestOrderClient';

export const dynamic = 'force-dynamic';

export default function ControlledTestOrderPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <ControlledTestOrderClient />
    </div>
  );
}
