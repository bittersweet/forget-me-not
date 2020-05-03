import { h } from "tsx-dom";
import * as punycode from "punycode";
import { container } from "tsyringe";

import { CleanupType } from "../shared/types";
import { RuleDialog } from "./dialogs/ruleDialog";
import { isValidExpression } from "../shared/expressionUtils";
import { Settings } from "../shared/settings";
import { RuleManager } from "../shared/ruleManager";

export function appendPunycode(domain: string) {
    const punified = punycode.toUnicode(domain);
    return punified === domain ? domain : `${domain} (${punified})`;
}

export function getSuggestedRuleExpression(domain: string, cookieName?: string) {
    if (cookieName) return `${cookieName.toLowerCase()}@${domain.startsWith(".") ? `*${domain}` : domain}`;
    return domain.startsWith(".") ? `*${domain}` : `*.${domain}`;
}

export function showAddRuleDialog(expression: string, next?: () => void) {
    if (isValidExpression(expression)) {
        // eslint-disable-next-line no-inner-declarations
        function onConfirm(type: CleanupType | false, changedExpression: string, temporary: boolean) {
            if (changedExpression && type !== false) {
                container.resolve(Settings).setRule(changedExpression, type, temporary);
                next?.();
            }
        }

        const definition = container.resolve(RuleManager).getExactRuleDefinition(expression);
        const focusType = definition ? definition.type : CleanupType.NEVER;
        const temporary = definition?.temporary || false;

        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        <RuleDialog
            expression={expression}
            editable
            focusType={focusType}
            temporary={temporary}
            onConfirm={onConfirm}
        />;
    }
}
