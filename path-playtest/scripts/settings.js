const MODULE_ID = "path-playtest";

export const VESSEL_SETTINGS = {
    master: "vesselAutomation",
    damage: "chatDamageFrustration",
    shadowCheck: "chatShadowWithinCheck",
    autoShadow: "autoShadowWithin",
    shadowAction: "postShadowWithinAction",
    suppress: "chatSuppressPresence",
    pained: "chatPainedFrustrationDamage",
    autoPained: "autoSuppressedDamage",
    vie: "askVieForControl"
};

Hooks.once("init", () => {
    registerBoolean(
        VESSEL_SETTINGS.master,
        "Enable Vessel Automation",
        "",
        true
    );

    registerBoolean(
        VESSEL_SETTINGS.damage,
        "Post Damage Frustration Prompt",
        "Post a chat prompt when a Vessel takes damage equal to or greater than twice their level, with a button to apply Frustrated.",
        true
    );

    registerBoolean(
        VESSEL_SETTINGS.shadowCheck,
        "Post The Shadow Within Check",
        "Post The Shadow Within flat check prompt or automatic roll result at the end of a Vessel's turn while they are in Persona Form and Frustrated.",
        true
    );

    registerBoolean(
        VESSEL_SETTINGS.autoShadow,
        "Automatically Resolve The Shadow Within",
        "Automatically roll The Shadow Within flat check. On a failure, increase Frustrated by 1 and activate Shadow Form.",
        false
    );

    registerBoolean(
        VESSEL_SETTINGS.shadowAction,
        "Post The Shadow Within Action on Failure",
        "Post The Shadow Within action to chat whenever its failure effect is applied, including automatically resolved failures.",
        true
    );

    registerBoolean(
        VESSEL_SETTINGS.suppress,
        "Post Suppress Presence Prompt",
        "At the start of a Vessel's turn in Shadow Form, post a chat prompt with a button to toggle Suppress Vessel's Presence.",
        true
    );

    registerBoolean(
        VESSEL_SETTINGS.pained,
        "Post Pained Frustration Damage",
        "Post the Pained Frustration damage caused by suppressed Vessel's Presence or Overwhelmed at the end of the Vessel's turn.",
        true
    );

    registerBoolean(
        VESSEL_SETTINGS.autoPained,
        "Automatically Apply Suppressed Presence Damage",
        "Automatically apply Pained Frustration damage caused by suppressing Vessel's Presence. This damage bypasses immunity and resistance.",
        false
    );

    registerBoolean(
        VESSEL_SETTINGS.vie,
        "Ask About Vie for Control",
        "At the start of a Vessel's turn in Shadow Form, post a chat reminder with a button to use Vie for Control.",
        false
    );
});

function registerBoolean(key, name, hint, defaultValue) {
    game.settings.register(MODULE_ID, key, {
        name,
        hint,
        scope: "world",
        config: true,
        type: Boolean,
        default: defaultValue
    });
}

export function vesselSettingEnabled(key = null) {
    if (!game.settings.get(MODULE_ID, VESSEL_SETTINGS.master)) {
        return false;
    }

    return key
        ? game.settings.get(MODULE_ID, key)
        : true;
}