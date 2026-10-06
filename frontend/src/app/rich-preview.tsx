import type { ReactNode } from 'react';
import type { Block, Run } from '../lib/rich-text';

function renderRun(run: Run, key: number): ReactNode {
  let node: ReactNode = run.text;
  if (run.bold) node = <strong>{node}</strong>;
  if (run.href) node = <a href={run.href} target="_blank" rel="noopener noreferrer nofollow">{node}</a>;
  return <span key={key}>{node}</span>;
}

/**
 * Renders the formatted note. Everything is a React element or an escaped text node, never HTML,
 * and links have already been reduced to http(s)/mailto by readBlocks.
 */
export default function RichPreview({ blocks }: { blocks: Block[] }) {
  return (
    <div className="rich-preview" role="region" aria-label="Vista con formato">
      {blocks.length === 0 && <p className="empty">Sin contenido.</p>}
      {blocks.map((block, index) => block.type === 'list'
        ? <ul key={index}>{block.items.map((item, position) => <li key={position}>{item.map(renderRun)}</li>)}</ul>
        : <p key={index}>{block.runs.map(renderRun)}</p>)}
    </div>
  );
}
