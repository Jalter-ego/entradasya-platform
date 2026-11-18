import type { DemoPayment } from '../api';

/**
 * PROVISORIO hasta que P4 entregue `PaymentFields` (features/payments).
 * Misma interfaz { value, onChange, disabled } para reemplazarlo sin tocar el checkout.
 * Solo pide la terminación de la tarjeta de demo: 1111 aprueba y 0000 rechaza. No hay datos reales.
 */
export function DemoPaymentFields({
  value, onChange, disabled,
}: { value: DemoPayment; onChange: (value: DemoPayment) => void; disabled?: boolean }) {
  const options: { last4: DemoPayment['last4']; label: string; hint: string }[] = [
    { last4: '1111', label: 'Tarjeta de demo •••• 1111', hint: 'El pago se aprueba.' },
    { last4: '0000', label: 'Tarjeta de demo •••• 0000', hint: 'El pago se rechaza (para probar).' },
  ];
  return (
    <fieldset className="fields demo-payment" disabled={disabled}>
      <legend className="field__label">Medio de pago</legend>
      {options.map((option) => (
        <label key={option.last4} className={`demo-payment__option ${value.last4 === option.last4 ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name="demo-last4"
            value={option.last4}
            checked={value.last4 === option.last4}
            onChange={() => onChange({ method: 'demo_card', last4: option.last4 })}
          />
          <span>
            <strong>{option.label}</strong>
            <span className="field__hint">{option.hint}</span>
          </span>
        </label>
      ))}
      <p className="field__hint">Pago simulado: no se cobra dinero real.</p>
    </fieldset>
  );
}
