const MODULE_ID = "path-playtest";

const FRUSTRATED = {
    uuid: "Compendium.path-playtest.Playtest.Item.MproUgBKCOt7IBkB",
    slug: "frustrated",
    max: 4
};

const OVERWHELMED = {
    uuid: "Compendium.path-playtest.Playtest.Item.ikeeCONeaFAdcAxE",
    slug: "overwhelmed"
};

const internalUpdates = new WeakSet();

function matches(item, { uuid, slug }) {
    return item?.type === "effect" && (
        item.system?.slug === slug ||
        item.sourceId === uuid ||
        item._stats?.compendiumSource === uuid
    );
}

const isFrustrated = (item) => matches(item, FRUSTRATED);
const isOverwhelmed = (item) => matches(item, OVERWHELMED);

function frustratedValue(item) {
    return Number(item?.system?.badge?.value ?? 0);
}

function effects(actor, matcher) {
    return actor.items.filter(matcher);
}

/* ------------------------------------------------------------------------- */
/* Public API                                                                */
/* ------------------------------------------------------------------------- */

export async function applyFrustrated(actor) {
    if (!actor?.isOwner) {
        throw new Error(
            `No tienes permiso para modificar Frustrated en ${actor?.name ?? "este actor"}.`
        );
    }

    const template = await fromUuid(FRUSTRATED.uuid);

    if (template?.documentName !== "Item" || template.type !== "effect") {
        throw new Error(`Invalid Frustrated UUID: ${FRUSTRATED.uuid}`);
    }

    const source = template.toObject();

    delete source._id;
    delete source.folder;
    delete source.ownership;

    await actor.createEmbeddedDocuments("Item", [source]);
}

/* ------------------------------------------------------------------------- */
/* Stack repeated applications                                               */
/* ------------------------------------------------------------------------- */

Hooks.on("preCreateItem", (item, _data, _options, userId) => {
    if (userId !== game.user.id || !isFrustrated(item)) return;

    const actor = item.parent;
    if (!actor || actor.documentName !== "Actor") return;

    const existing = effects(actor, isFrustrated);
    if (!existing.length) return;

    void stackFrustrated(actor, existing);

    return false;
});

async function stackFrustrated(actor, existing) {
    if (!actor.isOwner) return;

    try {
        internalUpdates.add(actor);

        const [primary, ...duplicates] = [...existing].sort(
            (a, b) => frustratedValue(b) - frustratedValue(a)
        );

        const current = Math.max(1, frustratedValue(primary));
        const next = Math.min(current + 1, FRUSTRATED.max);

        if (next !== current) {
            await primary.update({
                "system.badge.value": next
            });
        }

        if (duplicates.length) {
            await actor.deleteEmbeddedDocuments(
                "Item",
                duplicates.map((effect) => effect.id)
            );
        }
    } catch (error) {
        console.error(
            `${MODULE_ID} | Failed to stack Frustrated.`,
            error
        );

        ui.notifications.error(
            "No se pudo actualizar Frustrated."
        );
    } finally {
        internalUpdates.delete(actor);
    }

    await syncOverwhelmed(actor);
}

/* ------------------------------------------------------------------------- */
/* Synchronize Overwhelmed                                                   */
/* ------------------------------------------------------------------------- */

Hooks.on("createItem", (item, _options, userId) => {
    if (userId !== game.user.id || !isFrustrated(item)) return;

    const actor = item.parent;
    if (!actor || internalUpdates.has(actor)) return;

    void syncOverwhelmed(actor);
});

Hooks.on("updateItem", (item, changes, _options, userId) => {
    if (
        userId !== game.user.id ||
        !isFrustrated(item) ||
        !foundry.utils.hasProperty(changes, "system.badge")
    ) return;

    const actor = item.parent;
    if (!actor || internalUpdates.has(actor)) return;

    void syncOverwhelmed(actor);
});

Hooks.on("deleteItem", (item, _options, userId) => {
    if (userId !== game.user.id || !isFrustrated(item)) return;

    const actor = item.parent;
    if (!actor || internalUpdates.has(actor)) return;

    queueMicrotask(() => void syncOverwhelmed(actor));
});

async function syncOverwhelmed(actor) {
    if (!actor?.isOwner) return;

    try {
        const frustrated = effects(actor, isFrustrated)
            .sort((a, b) => frustratedValue(b) - frustratedValue(a))[0];

        const value = frustratedValue(frustrated);
        const overwhelmed = effects(actor, isOverwhelmed);

        if (value >= FRUSTRATED.max) {
            if (overwhelmed.length) {
                if (overwhelmed.length > 1) {
                    await actor.deleteEmbeddedDocuments(
                        "Item",
                        overwhelmed.slice(1).map((effect) => effect.id)
                    );
                }

                return;
            }

            const template = await fromUuid(OVERWHELMED.uuid);

            if (template?.documentName !== "Item" || template.type !== "effect") {
                throw new Error(
                    `Invalid Overwhelmed UUID: ${OVERWHELMED.uuid}`
                );
            }

            const source = template.toObject();

            delete source._id;
            delete source.folder;
            delete source.ownership;

            await actor.createEmbeddedDocuments("Item", [source]);
            return;
        }

        if (overwhelmed.length) {
            await actor.deleteEmbeddedDocuments(
                "Item",
                overwhelmed.map((effect) => effect.id)
            );
        }
    } catch (error) {
        console.error(
            `${MODULE_ID} | Failed to synchronize Overwhelmed.`,
            error
        );

        ui.notifications.error(
            "No se pudo sincronizar Overwhelmed."
        );
    }
}