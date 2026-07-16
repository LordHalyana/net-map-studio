import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { PolicyRuleCalloutData } from './graphToFlow';

/**
 * The concept's rule annotation card (visual-parity M4, gap G4): a dark
 * callout listing allow/deny lines in their action colors, capped with
 * "+n more". Non-interactive — PolicyRules are edited in the Rules panel.
 */
export const PolicyRuleCalloutNode = memo(function PolicyRuleCalloutNode({
  data,
}: NodeProps<Node<PolicyRuleCalloutData, 'policyRuleCallout'>>) {
  const { lines, more } = data;
  return (
    <div className="policy-rule-callout" data-testid="policy-rule-callout">
      <span className="policy-rule-callout__title">Rule</span>
      {lines.map((line, index) => (
        <span
          key={index}
          className={`policy-rule-callout__line policy-rule-callout__line--${line.action}`}
        >
          <span className="policy-rule-callout__action">{line.action}:</span> {line.text}
        </span>
      ))}
      {more > 0 && <span className="policy-rule-callout__more">+{more} more</span>}
    </div>
  );
});
