import { memo } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { useAppStore } from '../state/store';
import type { PolicyRuleCalloutData } from './graphToFlow';

/**
 * The concept's rule annotation card (visual-parity M4, gap G4): a dark
 * callout listing allow/deny lines in their action colors, capped with
 * "+n more". Clicking a line (or the card) opens that rule in the Rules tab
 * with the row focused (M3, #60) — editing stays in the Rules panel.
 */
export const PolicyRuleCalloutNode = memo(function PolicyRuleCalloutNode({
  data,
}: NodeProps<Node<PolicyRuleCalloutData, 'policyRuleCallout'>>) {
  const focusRule = useAppStore((s) => s.focusRule);
  const { lines, more, ruleIds } = data;
  const first = ruleIds[0];
  return (
    <div
      className="policy-rule-callout policy-rule-callout--clickable"
      data-testid="policy-rule-callout"
      role="button"
      tabIndex={0}
      onClick={() => first && focusRule(first)}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && first) focusRule(first);
      }}
    >
      <span className="policy-rule-callout__title">Rule</span>
      {lines.map((line, index) => (
        <span
          key={index}
          className={`policy-rule-callout__line policy-rule-callout__line--${line.action}`}
          data-testid={`policy-rule-callout-line-${line.ruleId}`}
          onClick={(event) => {
            event.stopPropagation();
            focusRule(line.ruleId);
          }}
        >
          <span className="policy-rule-callout__action">{line.action}:</span> {line.text}
        </span>
      ))}
      {more > 0 && <span className="policy-rule-callout__more">+{more} more</span>}
    </div>
  );
});
