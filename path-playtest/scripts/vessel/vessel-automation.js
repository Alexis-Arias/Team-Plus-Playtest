import {
    VESSEL_SETTINGS,
    vesselSettingEnabled
} from "../settings.js";

import {
    applyFrustrated
} from "./frustrated.js";

const MODULE_ID = "path-playtest";

const UUID = {
    vessel: "Compendium.path-playtest.Playtest.Item.InMl0o6J9v3eQyNB",
    overwhelmed: "Compendium.path-playtest.Playtest.Item.ikeeCONeaFAdcAxE",
    shadowWithin: "Compendium.path-playtest.Playtest.Item.bTPFfTBVu7ypxH6e",
    vie: "Compendium.path-playtest.Playtest.Item.b8dmAF2Dteuuk3j6"
};

const OPTION = {
    shadow: "shadow-form",
    suppress: "vessels-presence-suppressed"
};

const busyMessages = new Set();

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function sourceMatches(item, uuid) {
    return (
        item?.sourceId === uuid ||
        item?._stats?.compendiumSource === uuid
    );
}

function sourceItem(actor, uuid) {
    return actor?.items?.find((item) => sourceMatches(item, uuid)) ?? null;
}

function isVessel(actor) {
    return !!actor?.items?.some(
        (item) =>
            item.type === "class" &&
            sourceMatches(item, UUID.vessel)
    );
}

function findEffect(actor, uuid, slug) {
    return actor?.items?.find(
        (item) =>
            item.type === "effect" &&
            (
                sourceMatches(item, uuid) ||
                item.system?.slug === slug
            )
    ) ?? null;
}

function frustrated(actor) {
    return Number(
        actor?.flags?.system?.vessel?.frustratedValue ?? 0
    );
}

function overwhelmed(actor) {
    return !!findEffect(
        actor,
        UUID.overwhelmed,
        "overwhelmed"
    );
}

function rollOption(actor, option) {
    return actor?.rollOptions?.all?.[option] === true;
}

function shadowForm(actor) {
    return (
        rollOption(actor, OPTION.shadow) ||
        actor?.flags?.system?.vessel?.form === "shadow"
    );
}

function level(actor) {
    return Number(
        actor?.level ??
        actor?.system?.details?.level?.value ??
        0
    );
}

function controller(actor) {
    const player = game.users
        .filter(
            (user) =>
                user.active &&
                !user.isGM &&
                actor.canUserModify(user, "update")
        )
        .sort((a, b) => a.id.localeCompare(b.id))[0];

    return player?.id ?? game.users.activeGM?.id ?? null;
}

function isController(actor) {
    return controller(actor) === game.user.id;
}

function combatOf(combatant) {
    return combatant?.parent?.documentName === "Combat"
        ? combatant.parent
        : null;
}

function tokenDocument(actor, combatant = null) {
    if (combatant?.token) return combatant.token;
    if (actor?.token) return actor.token;

    const token = actor?.getActiveTokens?.(true, true)?.[0];

    return token?.document ?? token ?? null;
}

function speaker(actor, combatant = null) {
    return ChatMessage.getSpeaker({
        actor,
        token: tokenDocument(actor, combatant)
    });
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function currentPromptTurn(data) {
    if (!data.combatId) return true;

    const combat = game.combats.get(data.combatId);

    return !!(
        combat &&
        combat.round === data.round &&
        combat.turn === data.turn &&
        combat.combatant?.id === data.combatantId
    );
}

function promptCombatant(data) {
    if (!data.combatId || !data.combatantId) {
        return null;
    }

    return (
        game.combats
            .get(data.combatId)
            ?.combatants
            .get(data.combatantId) ??
        null
    );
}

/* ------------------------------------------------------------------------- */
/* Roll Options                                                              */
/* ------------------------------------------------------------------------- */

async function setOption(actor, option, value) {
    const result = await actor.toggleRollOption(
        "all",
        option,
        value
    );

    if (result === null) {
        throw new Error(`RollOption not found: ${option}`);
    }

    return result;
}

/* ------------------------------------------------------------------------- */
/* Chat                                                                      */
/* ------------------------------------------------------------------------- */

async function createPrompt(
    actor,
    type,
    content,
    combatant = null,
    data = {}
) {
    const combat = combatOf(combatant);

    return ChatMessage.create({
        speaker: speaker(actor, combatant),
        content,
        flags: {
            [MODULE_ID]: {
                vesselPrompt: {
                    type,
                    actorUuid: actor.uuid,
                    controllerId: controller(actor) ?? game.user.id,
                    resolved: false,
                    combatId: combat?.id ?? null,
                    combatantId: combatant?.id ?? null,
                    round: combat?.round ?? null,
                    turn: combat?.turn ?? null,
                    ...data
                }
            }
        }
    });
}

async function updatePrompt(message, changes) {
    const data = message.getFlag(
        MODULE_ID,
        "vesselPrompt"
    );

    if (!data) return;

    await message.setFlag(
        MODULE_ID,
        "vesselPrompt",
        {
            ...data,
            ...changes
        }
    );
}

async function postItemToChat(item) {
    if (!item) return false;

    await item.toMessage();
    return true;
}

/* ------------------------------------------------------------------------- */
/* Optional PF2e Toolbelt Integration                                        */
/* ------------------------------------------------------------------------- */

async function tryToolbeltAction(item) {
    /*
     * Toolbelt is optional.
     *
     * We deliberately do not hard-depend on a private API here.
     * If Actionable exposes a public useAction function in the installed
     * Toolbelt version, this attempts to use it. Otherwise the automation
     * simply falls back to posting the action card.
     *
     * Runtime test this against the installed Toolbelt version.
     */

    const actionable = game.toolbelt?.api?.actionable;

    if (
        !item ||
        typeof actionable?.useAction !== "function"
    ) {
        return false;
    }

    try {
        await actionable.useAction(item);
        return true;
    } catch (error) {
        console.warn(
            `${MODULE_ID} | Toolbelt Actionable integration failed.`,
            error
        );

        return false;
    }
}

/* ------------------------------------------------------------------------- */
/* The Shadow Within Failure                                                 */
/* ------------------------------------------------------------------------- */

async function applyShadowWithinFailure(actor) {
    /*
     * frustrated.js is the sole owner of Frustrated creation/stacking.
     */
    await applyFrustrated(actor);

    /*
     * Frustrated now exists, so the Shadow Form toggle should no longer
     * be disabled by its disabledIf predicate.
     */
    await setOption(
        actor,
        OPTION.shadow,
        true
    );

    const action = sourceItem(
        actor,
        UUID.shadowWithin
    );

    if (!action) {
        ui.notifications.warn(
            `The Shadow Within was not found on ${actor.name}.`
        );

        return;
    }

    /*
     * Toolbelt integration is optional. If Actionable is available,
     * attempt to use the action so any configured Action Macro can run.
     */
    await tryToolbeltAction(action);

    /*
     * This setting independently controls whether the action card itself
     * is posted to chat after the failure effect is applied.
     */
    if (
        vesselSettingEnabled(
            VESSEL_SETTINGS.shadowAction
        )
    ) {
        await postItemToChat(action);
    }
}

/* ------------------------------------------------------------------------- */
/* Damage Trigger                                                            */
/* ------------------------------------------------------------------------- */

Hooks.on(
    "updateActor",
    (actor, _changes, options, userId) => {
        if (
            userId !== game.user.id ||
            !vesselSettingEnabled(
                VESSEL_SETTINGS.damage
            ) ||
            !isVessel(actor)
        ) {
            return;
        }

        const damage = Math.trunc(
            Number(options?.damageTaken ?? 0)
        );

        const threshold = level(actor) * 2;

        if (
            damage <= 0 ||
            threshold <= 0 ||
            damage < threshold
        ) {
            return;
        }

        void createPrompt(
            actor,
            "damage-frustration",
            `
            <div class="path-playtest-vessel-prompt">
                <p>
                    <strong>The Shadow Within</strong>
                </p>

                <p>
                    ${escapeHTML(actor.name)} took
                    <strong>${damage} damage</strong>,
                    meeting the
                    <strong>${threshold} damage</strong>
                    threshold.
                </p>

                <button
                    type="button"
                    data-vessel-action="apply-frustrated"
                >
                    Apply Frustrated
                </button>
            </div>
            `
        ).catch(reportError);
    }
);

/* ------------------------------------------------------------------------- */
/* Combat                                                                    */
/* ------------------------------------------------------------------------- */

function forwardTurn(prior, current) {
    if (!current.combatantId) return false;

    if (!prior.combatantId) {
        return true;
    }

    if (current.round !== prior.round) {
        return current.round > prior.round;
    }

    return (
        (current.turn ?? -1) >
        (prior.turn ?? -1)
    );
}

Hooks.on(
    "combatTurnChange",
    (combat, prior, current) => {
        if (
            !vesselSettingEnabled() ||
            !forwardTurn(prior, current)
        ) {
            return;
        }

        const previous = prior.combatantId
            ? combat.combatants.get(prior.combatantId)
            : null;

        const next = current.combatantId
            ? combat.combatants.get(current.combatantId)
            : null;

        if (
            previous?.actor &&
            isVessel(previous.actor) &&
            isController(previous.actor)
        ) {
            void endTurn(previous).catch(reportError);
        }

        if (
            next?.actor &&
            isVessel(next.actor) &&
            isController(next.actor)
        ) {
            void startTurn(next).catch(reportError);
        }
    }
);

/* ------------------------------------------------------------------------- */
/* Turn Start                                                                */
/* ------------------------------------------------------------------------- */

async function startTurn(combatant) {
    const actor = combatant.actor;

    if (!shadowForm(actor)) {
        return;
    }

    /*
     * Suppression automatically ends at the beginning of your next turn.
     */
    if (rollOption(actor, OPTION.suppress)) {
        try {
            await setOption(
                actor,
                OPTION.suppress,
                false
            );
        } catch (error) {
            console.warn(
                `${MODULE_ID} | Failed to reset Vessel's Presence suppression.`,
                error
            );
        }
    }

    if (frustrated(actor) < 1) {
        return;
    }

    /*
     * Vie for Control reminder.
     * This setting is OFF by default.
     */
    if (
        vesselSettingEnabled(
            VESSEL_SETTINGS.vie
        )
    ) {
        await createPrompt(
            actor,
            "vie-for-control",
            `
            <div class="path-playtest-vessel-prompt">
                <p>
                    <strong>Vie for Control</strong>
                </p>

                <p>
                    Do you want to use Vie for Control?
                </p>

                <button
                    type="button"
                    data-vessel-action="use-vie"
                >
                    Use Vie for Control
                </button>
            </div>
            `,
            combatant
        );
    }

    /*
     * An Overwhelmed Vessel cannot suppress Vessel's Presence.
     */
    if (
        vesselSettingEnabled(
            VESSEL_SETTINGS.suppress
        ) &&
        !overwhelmed(actor)
    ) {
        await createPrompt(
            actor,
            "suppress-presence",
            `
            <div class="path-playtest-vessel-prompt">
                <p>
                    <strong>
                        Suppress Vessel's Presence?
                    </strong>
                </p>

                <p>
                    You can suppress Vessel's Presence until
                    the beginning of your next turn.
                </p>

                <button
                    type="button"
                    data-vessel-action="toggle-suppress"
                >
                    Toggle Suppression
                </button>
            </div>
            `,
            combatant
        );
    }
}

/* ------------------------------------------------------------------------- */
/* Turn End                                                                  */
/* ------------------------------------------------------------------------- */

async function endTurn(combatant) {
    const actor = combatant.actor;
    const value = frustrated(actor);

    if (value < 1) {
        return;
    }

    /*
     * Persona Form -> The Shadow Within
     */
    if (!shadowForm(actor)) {
        await handleShadowWithin(
            actor,
            combatant,
            value
        );

        return;
    }

    /*
     * Shadow Form -> Pained Frustration
     */
    const isOverwhelmed = overwhelmed(actor);
    const isSuppressed = rollOption(
        actor,
        OPTION.suppress
    );

    if (
        !isOverwhelmed &&
        !isSuppressed
    ) {
        return;
    }

    const amount = isOverwhelmed
        ? value + level(actor)
        : value;

    const damageType =
        actor.flags?.system?.vessel?.shadow
            ?.painedFrustration ??
        null;

    if (!damageType) {
        throw new Error(
            `No Pained Frustration damage type is configured for ${actor.name}.`
        );
    }

    /*
     * The requested auto-apply setting controls suppression damage.
     * Overwhelmed damage remains a chat/manual resolution for now.
     */
    const autoApply =
        isSuppressed &&
        !isOverwhelmed &&
        vesselSettingEnabled(
            VESSEL_SETTINGS.autoPained
        );

    if (
        vesselSettingEnabled(
            VESSEL_SETTINGS.pained
        )
    ) {
        await createPrompt(
            actor,
            "pained-frustration",
            `
            <div class="path-playtest-vessel-prompt">
                <p>
                    <strong>Pained Frustration</strong>
                </p>

                <p>
                    ${escapeHTML(actor.name)} takes
                    <strong>
                        ${amount} ${escapeHTML(damageType)} damage
                    </strong>
                    ${
                        isOverwhelmed
                            ? "from being Overwhelmed."
                            : "because Vessel's Presence was suppressed."
                    }
                </p>

                <p>
                    This damage ignores immunity and resistance.
                </p>

                ${
                    autoApply
                        ? `
                        <p>
                            <em>
                                Damage applied automatically.
                            </em>
                        </p>
                        `
                        : `
                        <button
                            type="button"
                            data-vessel-action="apply-pained"
                        >
                            Apply Pained Frustration
                        </button>
                        `
                }
            </div>
            `,
            combatant,
            {
                amount,
                damageType,
                resolved: autoApply
            }
        );
    }

    if (autoApply) {
        await applyPainedFrustration(
            actor,
            combatant,
            amount,
            damageType
        );
    }
}

/* ------------------------------------------------------------------------- */
/* The Shadow Within                                                         */
/* ------------------------------------------------------------------------- */

async function handleShadowWithin(
    actor,
    combatant,
    value
) {
    const dc = 5 + value;

    /*
     * Automatic resolution.
     */
    if (
        vesselSettingEnabled(
            VESSEL_SETTINGS.autoShadow
        )
    ) {
        const roll = await new Roll("1d20").evaluate();
        const failed = roll.total < dc;

        if (
            vesselSettingEnabled(
                VESSEL_SETTINGS.shadowCheck
            )
        ) {
            await roll.toMessage({
                speaker: speaker(
                    actor,
                    combatant
                ),
                flavor: `
                    <strong>
                        The Shadow Within
                    </strong>
                    — DC ${dc} Flat Check —
                    <strong>
                        ${failed ? "Failure" : "Success"}
                    </strong>
                `
            });
        }

        if (failed) {
            await applyShadowWithinFailure(actor);
        }

        return;
    }

    /*
     * Manual mode.
     */
    if (
        !vesselSettingEnabled(
            VESSEL_SETTINGS.shadowCheck
        )
    ) {
        return;
    }

    await createPrompt(
        actor,
        "shadow-within",
        `
        <div class="path-playtest-vessel-prompt">
            <p>
                <strong>
                    The Shadow Within
                </strong>
            </p>

            <p>
                ${escapeHTML(actor.name)} ends their turn in
                Persona Form with
                <strong>Frustrated ${value}</strong>.
            </p>

            <p>
                Attempt a
                <strong>DC ${dc} flat check</strong>.
            </p>

            <div class="flexrow">
                <button
                    type="button"
                    data-vessel-action="roll-shadow"
                >
                    Roll Flat Check
                </button>

                <button
                    type="button"
                    data-vessel-action="apply-shadow-failure"
                >
                    Apply Failure Effect
                </button>
            </div>
        </div>
        `,
        combatant,
        {
            dc,
            rolled: false,
            failed: false
        }
    );
}

/* ------------------------------------------------------------------------- */
/* Pained Frustration                                                        */
/* ------------------------------------------------------------------------- */

async function applyPainedFrustration(
    actor,
    combatant,
    amount,
    damageType
) {
    const token = tokenDocument(
        actor,
        combatant
    );

    if (!token) {
        throw new Error(
            `No token was found for ${actor.name}.`
        );
    }

    /*
     * final: true is intentionally used so this amount is treated as final
     * damage rather than being passed through normal IWR mitigation.
     *
     * Runtime-test this in PF2e 8.4.0 before relying on it for production.
     */
    await actor.applyDamage({
        damage: Number(amount),
        token,
        final: true,
        breakdown: [
            `Pained Frustration (${damageType})`
        ]
    });
}

/* ------------------------------------------------------------------------- */
/* Vie for Control                                                           */
/* ------------------------------------------------------------------------- */

async function useVieForControl(actor) {
    const item = sourceItem(
        actor,
        UUID.vie
    );

    if (!item) {
        throw new Error(
            `Vie for Control was not found on ${actor.name}.`
        );
    }

    /*
     * Prefer Toolbelt Actionable when present so an Action Macro attached
     * to Vie for Control can run. Otherwise post the normal action card.
     */
    if (!(await tryToolbeltAction(item))) {
        await postItemToChat(item);
    }
}

/* ------------------------------------------------------------------------- */
/* Chat Buttons                                                              */
/* ------------------------------------------------------------------------- */

Hooks.on(
    "renderChatMessageHTML",
    (message, html) => {
        const data = message.getFlag(
            MODULE_ID,
            "vesselPrompt"
        );

        if (!data) {
            return;
        }

        const buttons = html.querySelectorAll(
            "[data-vessel-action]"
        );

        if (
            !vesselSettingEnabled() ||
            data.resolved ||
            data.controllerId !== game.user.id
        ) {
            for (const button of buttons) {
                button.remove();
            }

            return;
        }

        /*
         * After rolling The Shadow Within manually:
         *
         * Success -> entire prompt resolves.
         * Failure -> roll button disappears and Apply Failure Effect remains.
         */
        if (
            data.type === "shadow-within" &&
            data.rolled
        ) {
            html
                .querySelector(
                    '[data-vessel-action="roll-shadow"]'
                )
                ?.remove();

            if (!data.failed) {
                html
                    .querySelector(
                        '[data-vessel-action="apply-shadow-failure"]'
                    )
                    ?.remove();
            }
        }

        for (
            const button of html.querySelectorAll(
                "[data-vessel-action]"
            )
        ) {
            button.addEventListener(
                "click",
                async (event) => {
                    event.preventDefault();

                    if (
                        busyMessages.has(message.id)
                    ) {
                        return;
                    }

                    busyMessages.add(message.id);

                    const allButtons =
                        html.querySelectorAll(
                            "[data-vessel-action]"
                        );

                    for (const element of allButtons) {
                        element.disabled = true;
                    }

                    try {
                        const current =
                            message.getFlag(
                                MODULE_ID,
                                "vesselPrompt"
                            );

                        if (
                            !current ||
                            current.resolved
                        ) {
                            return;
                        }

                        const actor = await fromUuid(
                            current.actorUuid
                        );

                        if (
                            actor?.documentName !== "Actor" ||
                            !isVessel(actor)
                        ) {
                            throw new Error(
                                "The Vessel actor could not be resolved."
                            );
                        }

                        switch (
                            button.dataset.vesselAction
                        ) {
                            /* ----------------------------------------- */
                            /* Damage threshold                         */
                            /* ----------------------------------------- */

                            case "apply-frustrated":
                                await applyFrustrated(actor);

                                await updatePrompt(
                                    message,
                                    {
                                        resolved: true
                                    }
                                );

                                break;

                            /* ----------------------------------------- */
                            /* Shadow Within flat check                 */
                            /* ----------------------------------------- */

                            case "roll-shadow": {
                                if (current.rolled) {
                                    break;
                                }

                                const roll =
                                    await new Roll(
                                        "1d20"
                                    ).evaluate();

                                const failed =
                                    roll.total <
                                    Number(current.dc);

                                await roll.toMessage({
                                    speaker: speaker(
                                        actor,
                                        promptCombatant(
                                            current
                                        )
                                    ),
                                    flavor: `
                                        <strong>
                                            The Shadow Within
                                        </strong>
                                        — DC ${current.dc} Flat Check —
                                        <strong>
                                            ${
                                                failed
                                                    ? "Failure"
                                                    : "Success"
                                            }
                                        </strong>
                                    `
                                });

                                await updatePrompt(
                                    message,
                                    {
                                        rolled: true,
                                        failed,
                                        resolved: !failed
                                    }
                                );

                                break;
                            }

                            /* ----------------------------------------- */
                            /* Shadow Within failure                    */
                            /* ----------------------------------------- */

                            case "apply-shadow-failure":
                                await applyShadowWithinFailure(
                                    actor
                                );

                                await updatePrompt(
                                    message,
                                    {
                                        resolved: true
                                    }
                                );

                                break;

                            /* ----------------------------------------- */
                            /* Suppress Presence                        */
                            /* ----------------------------------------- */

                            case "toggle-suppress": {
                                if (
                                    !currentPromptTurn(
                                        current
                                    )
                                ) {
                                    throw new Error(
                                        "This Suppress Vessel's Presence prompt is no longer current."
                                    );
                                }

                                if (!shadowForm(actor)) {
                                    throw new Error(
                                        "The actor is no longer in Shadow Form."
                                    );
                                }

                                if (overwhelmed(actor)) {
                                    throw new Error(
                                        "Overwhelmed prevents suppressing Vessel's Presence."
                                    );
                                }

                                const next =
                                    !rollOption(
                                        actor,
                                        OPTION.suppress
                                    );

                                await setOption(
                                    actor,
                                    OPTION.suppress,
                                    next
                                );

                                ui.notifications.info(
                                    `Vessel's Presence is ${
                                        next
                                            ? "suppressed"
                                            : "active"
                                    }.`
                                );

                                break;
                            }

                            /* ----------------------------------------- */
                            /* Pained Frustration                       */
                            /* ----------------------------------------- */

                            case "apply-pained":
                                await applyPainedFrustration(
                                    actor,
                                    promptCombatant(
                                        current
                                    ),
                                    current.amount,
                                    current.damageType
                                );

                                await updatePrompt(
                                    message,
                                    {
                                        resolved: true
                                    }
                                );

                                break;

                            /* ----------------------------------------- */
                            /* Vie for Control                          */
                            /* ----------------------------------------- */

                            case "use-vie":
                                if (
                                    !currentPromptTurn(
                                        current
                                    )
                                ) {
                                    throw new Error(
                                        "This Vie for Control prompt is no longer current."
                                    );
                                }

                                await useVieForControl(
                                    actor
                                );

                                await updatePrompt(
                                    message,
                                    {
                                        resolved: true
                                    }
                                );

                                break;
                        }
                    } catch (error) {
                        reportError(error);
                    } finally {
                        busyMessages.delete(
                            message.id
                        );

                        for (
                            const element of allButtons
                        ) {
                            element.disabled = false;
                        }
                    }
                }
            );
        }
    }
);

/* ------------------------------------------------------------------------- */
/* Errors                                                                    */
/* ------------------------------------------------------------------------- */

function reportError(error) {
    console.error(
        `${MODULE_ID} | Vessel automation failed.`,
        error
    );

    ui.notifications.error(
        error?.message ??
        "Vessel automation failed."
    );
}