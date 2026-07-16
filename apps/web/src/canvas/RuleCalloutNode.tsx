import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { RuleCalloutData } from './graphToFlow';

/**
 * The concept's rule annotation card (visual-parity M4, gap G4): a dark
 * callout listing allow/deny lines in their action colors, capped with
 * "+n more". Non-interactive — PolicyRules are edited in the Rules panel.
 */
export const RuleCalloutNode = memo(function RuleCalloutNode({
  data,
}: NodeProps<Node<RuleCalloutData, 'ruleCallout'>>) {
  const { lines, more } = data;
  return (
    <div className="rule-callout" data-testid="rule-callout">
      <span className="rule-callout__title">Rule</span>
      {lines.map((line, index) => (
        <span key={index} className={`rule-callout__line rule-callout__line--${line.action}`}>
          <span className="rule-callout__action">{line.action}:</span> {line.text}
        </span>
      ))}
      {more > 0 && <span className="rule-callout__more">+{more} more</span>}
    </div>
  );
});
