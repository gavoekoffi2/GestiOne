'use client';

import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import { Alert, Badge, Button, Card, EmptyState } from '@/components/ui/primitives';
import { useApi } from '@/components/ui/use-api';

/**
 * Import en deux temps : analyser, puis confirmer.
 *
 * L'utilisateur voit exactement ce qui sera cree, ce qui sera ignore et
 * pourquoi, avant que la base ne bouge. Un import qui ecrit d'abord et signale
 * les erreurs ensuite laisse une base a moitie remplie que personne ne sait
 * nettoyer.
 */

interface PreviewRow {
  line: number;
  status: 'ready' | 'duplicate' | 'error';
  message?: string;
  values: Record<string, string>;
}

interface Preview {
  columns: string[];
  detectedDelimiter: string;
  missingColumns: string[];
  rows: PreviewRow[];
  readyCount: number;
  duplicateCount: number;
  errorCount: number;
}

interface ImportResult {
  created: number;
  skipped: number;
  failed: Array<{ line: number; message: string }>;
}

export function ImportWizard({
  target,
  label,
  requiredColumns,
}: {
  target: 'clients' | 'produits';
  label: string;
  requiredColumns: string[];
}) {
  const router = useRouter();
  const api = useApi();
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setResult(null);
    setPreview(null);
    api.reset();

    // Lecture cote client : l'utilisateur voit immediatement s'il a choisi le
    // bon fichier, avant tout aller-retour reseau.
    const text = await file.text();
    setContent(text);
    setFileName(file.name);
  }

  async function analyse() {
    const data = await api.send<Preview>(`/api/imports/${target}`, {
      method: 'POST',
      body: { content, confirm: false },
    });
    if (data) setPreview(data);
  }

  async function confirm() {
    const data = await api.send<ImportResult>(`/api/imports/${target}`, {
      method: 'POST',
      body: { content, confirm: true },
      successMessage: 'Import terminé.',
    });
    if (data) {
      setResult(data);
      setPreview(null);
      router.refresh();
    }
  }

  function reset() {
    setContent('');
    setFileName('');
    setPreview(null);
    setResult(null);
    api.reset();
  }

  return (
    <Card
      title={`Importer des ${label.toLowerCase()}`}
      description={`Colonnes obligatoires : ${requiredColumns.join(', ')}. Les autres sont facultatives.`}
      action={
        <a
          href={`/api/imports/${target}`}
          className="text-sm font-semibold text-brand-700 hover:underline"
        >
          Télécharger le modèle
        </a>
      }
    >
      <div className="space-y-4">
        {api.error && <Alert tone="error">{api.error}</Alert>}

        {result ? (
          <>
            <Alert tone="success" title="Import terminé">
              {result.created} {label.toLowerCase()} créé(s).
              {result.skipped > 0 && ` ${result.skipped} ligne(s) ignorée(s).`}
            </Alert>

            {result.failed.length > 0 && (
              <Alert tone="warning" title="Lignes non importées">
                <ul className="mt-1 space-y-0.5">
                  {result.failed.slice(0, 10).map((failure) => (
                    <li key={failure.line}>
                      Ligne {failure.line} : {failure.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}

            <Button type="button" variant="secondary" onClick={reset}>
              Importer un autre fichier
            </Button>
          </>
        ) : (
          <>
            <div>
              <label htmlFor={`file-${target}`} className="block text-sm font-medium text-ink-700">
                Fichier CSV
              </label>
              <input
                id={`file-${target}`}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="mt-1 block w-full text-sm text-ink-600 file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-brand-700 file:px-4 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-800"
              />
              <p className="mt-1 text-xs text-ink-500">
                Exports Excel et LibreOffice acceptés : séparateur virgule ou point-virgule,
                accents préservés.
              </p>
            </div>

            {content && !preview && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={analyse} disabled={api.pending}>
                  {api.pending ? 'Analyse...' : `Analyser ${fileName}`}
                </Button>
                <Button type="button" variant="ghost" onClick={reset}>
                  Changer de fichier
                </Button>
              </div>
            )}

            {preview && preview.missingColumns.length > 0 && (
              <Alert tone="error" title="Colonnes manquantes">
                Le fichier ne contient pas : {preview.missingColumns.join(', ')}. Colonnes
                trouvées : {preview.columns.join(', ')}.
              </Alert>
            )}

            {preview && preview.missingColumns.length === 0 && (
              <>
                <div className="flex flex-wrap gap-3 text-sm">
                  <Badge tone="success">{preview.readyCount} a importer</Badge>
                  {preview.duplicateCount > 0 && (
                    <Badge tone="neutral">{preview.duplicateCount} déjà existant(s)</Badge>
                  )}
                  {preview.errorCount > 0 && (
                    <Badge tone="danger">{preview.errorCount} en erreur</Badge>
                  )}
                </div>

                {preview.rows.length === 0 ? (
                  <EmptyState title="Fichier vide" description="Aucune ligne de données trouvée." />
                ) : (
                  <div className="max-h-96 overflow-auto rounded-lg border border-ink-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-ink-50">
                        <tr className="text-xs uppercase tracking-wide text-ink-500">
                          <th className="px-3 py-2 font-medium">Ligne</th>
                          <th className="px-3 py-2 font-medium">Nom</th>
                          <th className="px-3 py-2 font-medium">État</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100">
                        {preview.rows.map((row) => (
                          <tr
                            key={row.line}
                            className={row.status === 'error' ? 'bg-red-50/50' : undefined}
                          >
                            <td className="tabular px-3 py-2 text-ink-500">{row.line}</td>
                            <td className="px-3 py-2 text-ink-800">{row.values.name || '—'}</td>
                            <td className="px-3 py-2">
                              {row.status === 'ready' ? (
                                <Badge tone="success">Prete</Badge>
                              ) : row.status === 'duplicate' ? (
                                <span className="text-xs text-ink-500">{row.message}</span>
                              ) : (
                                <span className="text-xs font-medium text-red-600">{row.message}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={confirm}
                    disabled={api.pending || preview.readyCount === 0}
                  >
                    {api.pending
                      ? 'Import en cours...'
                      : `Importer ${preview.readyCount} ${label.toLowerCase()}`}
                  </Button>
                  <Button type="button" variant="secondary" onClick={reset}>
                    Annuler
                  </Button>
                </div>

                {preview.duplicateCount > 0 && (
                  <p className="text-xs text-ink-500">
                    Les lignes déjà existantes sont ignorées, jamais écrasées : un fichier
                    réimporté par erreur ne remplacera pas vos corrections.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
