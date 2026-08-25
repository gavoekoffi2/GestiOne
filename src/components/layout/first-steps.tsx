import Link from 'next/link';
import { Card } from '@/components/ui/primitives';
import { Icon } from '@/components/layout/icons';
import { hasPermission, type PermissionKey } from '@/server/permissions';
import type { SetupStep } from '@/server/services/onboarding';

/**
 * Guide de demarrage.
 *
 * Une entreprise qui vient d'etre creee n'a rien a lire sur un tableau de bord :
 * huit indicateurs a zero ne disent pas quoi faire. Ce bloc remplace ce vide par
 * le chemin le plus court jusqu'a la premiere vente, chaque etape menant
 * directement a l'ecran concerne.
 *
 * Il disparait de lui-meme des que toutes les etapes sont franchies : un guide
 * qui reste affiche apres coup devient du bruit.
 */
export function FirstSteps({
  steps,
  permissions,
}: {
  steps: SetupStep[];
  permissions: readonly string[];
}) {
  // Une etape qu'on n'a pas le droit d'accomplir n'est pas affichee : un
  // caissier ne doit pas se voir reprocher un catalogue vide.
  // hasPermission, et non includes : le role Administrateur porte un joker
  // plutot que la liste complete des droits.
  const visible = steps.filter(
    (step) => !step.permission || hasPermission(permissions, step.permission as PermissionKey),
  );
  if (visible.length === 0 || visible.every((step) => step.done)) return null;

  const done = visible.filter((step) => step.done).length;
  const next = visible.find((step) => !step.done);

  return (
    <Card
      title="Vos premiers pas"
      description="Quatre étapes suffisent pour vendre avec GestiOne."
      action={
        <span className="text-sm font-semibold text-brand-700">
          {done} / {visible.length}
        </span>
      }
    >
      <ol className="space-y-2">
        {visible.map((step) => {
          const isNext = step.key === next?.key;
          return (
            <li
              key={step.key}
              className={`flex flex-wrap items-center gap-3 rounded-lg p-3 ${
                isNext ? 'bg-brand-50 ring-1 ring-brand-200' : ''
              }`}
            >
              <span
                aria-hidden
                className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  step.done
                    ? 'bg-brand-700 text-white'
                    : isNext
                      ? 'bg-white text-brand-700 ring-2 ring-brand-700'
                      : 'bg-ink-100 text-ink-500'
                }`}
              >
                {step.done ? <Icon name="check" className="size-4" /> : visible.indexOf(step) + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold ${
                    step.done ? 'text-ink-400 line-through' : 'text-ink-900'
                  }`}
                >
                  {step.label}
                </p>
                {!step.done && <p className="text-xs text-ink-600">{step.description}</p>}
              </div>

              {!step.done && step.href && (
                <Link
                  href={step.href}
                  className={`min-h-9 shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${
                    isNext
                      ? 'bg-brand-700 text-white hover:bg-brand-800'
                      : 'text-brand-700 hover:underline'
                  }`}
                >
                  {step.action ?? 'Ouvrir'}
                </Link>
              )}

              {step.done && <span className="sr-only">Fait</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
