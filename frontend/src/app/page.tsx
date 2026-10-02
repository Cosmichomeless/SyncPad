import type { WorkspaceSummary } from '@syncpad/shared';

export default function Home() {
  const workspaceName = (workspace: WorkspaceSummary | undefined) => workspace?.name ?? 'SyncPad';

  return (
    <main>
      <p className="eyebrow">Workspace colaborativo · Proyecto experimental</p>
      <h1>{workspaceName(undefined)}</h1>
      <p>
        Nuestro objetivo es crear un espacio de notas y documentos colaborativos
        que funcione en tiempo real y también offline.
      </p>
      <p>
        Queremos explorar cómo sincronizar cambios y resolver conflictos cuando
        dos personas editan un documento y una de ellas está sin conexión.
      </p>
      <p className="status">
        Esta es la base inicial del frontend. La colaboración, la edición y el
        acceso de usuarios aún no están implementados.
      </p>
    </main>
  );
}
