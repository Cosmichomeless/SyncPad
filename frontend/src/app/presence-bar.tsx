import type { CSSProperties } from 'react';
import type { Participant, RemoteSelection } from '../lib/presence';

type Props = { participants: Participant[]; selections: RemoteSelection[] };

/** Who is in the note and what they have selected. Text only: no HTML from peers is ever injected. */
export default function PresenceBar({ participants, selections }: Props) {
  if (participants.length === 0) return null;
  return (
    <div className="presence">
      <ul className="presence-list" aria-label="Participantes conectados">
        {participants.map((participant) => (
          <li key={participant.userId} className="presence-chip" style={{ '--presence': participant.color } as CSSProperties} title={participant.email}>
            <span className="presence-dot" aria-hidden="true" />
            {participant.name}
            {participant.isSelf && ' (tú)'}
            {participant.connections > 1 && ` · ${participant.connections} pestañas`}
          </li>
        ))}
      </ul>
      {selections.length > 0 && (
        <ul className="presence-selections" aria-label="Selecciones de otros participantes">
          {selections.map((selection) => (
            <li key={selection.connectionId} style={{ '--presence': selection.color } as CSSProperties}>
              <span className="presence-name">{selection.name}</span>
              {': '}
              {selection.before}
              {selection.selected ? <mark>{selection.selected}</mark> : <span className="presence-caret" aria-label="cursor">|</span>}
              {selection.after}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
