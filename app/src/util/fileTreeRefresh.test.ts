import * as assert from "node:assert/strict";
import {afterEach, test} from "node:test";
import {refreshFileTreeChildren, refreshFileTreeRows} from "./fileTreeRefresh";

class TreeNode {
    public children: TreeNode[] = [];
    public parent: TreeNode;
    public arrow: TreeNode;
    public label = "current";
    public mutations = {insert: 0, remove: 0};
    private classes = new Set<string>();
    public classList = {
        contains: (name: string) => this.classes.has(name),
        add: (name: string) => this.classes.add(name),
    };

    constructor(public tagName: string, public id?: string) {
    }

    public get nextElementSibling() {
        return this.parent?.children[this.parent.children.indexOf(this) + 1] || null;
    }

    public get firstElementChild() {
        return this.children[0] || null;
    }

    public get parentElement() {
        return this.parent;
    }

    public isEqualNode(other: TreeNode): boolean {
        return this.tagName === other.tagName && this.id === other.id && this.label === other.label &&
            [...this.classes].sort().join(",") === [...other.classes].sort().join(",") &&
            ((!this.arrow && !other.arrow) || (!!this.arrow && !!other.arrow && this.arrow.isEqualNode(other.arrow)));
    }

    public remove() {
        this.detach();
    }

    public insertBefore(node: TreeNode, reference: TreeNode) {
        node.detach();
        const index = reference ? this.children.indexOf(reference) : this.children.length;
        assert.ok(index >= 0);
        this.children.splice(index, 0, node);
        node.parent = this;
        this.mutations.insert++;
    }

    public getAttribute(name: string) {
        assert.equal(name, "data-node-id");
        return this.id || null;
    }

    public contains(node: TreeNode): boolean {
        return this === node || this.children.some(child => child.contains(node));
    }

    public querySelector(selector: string) {
        if (selector === ".b3-list-item__arrow") {
            return this.arrow;
        }
        assert.equal(selector, ".b3-list-item__arrow--open");
        return this.arrow?.classList.contains("b3-list-item__arrow--open") ? this.arrow : null;
    }

    public after(node: TreeNode) {
        node.detach();
        node.parent = this.parent;
        this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
    }

    public replaceChildren(fragment: TreeNode) {
        this.children.forEach(child => child.parent = undefined);
        this.children = [...fragment.children];
        fragment.children = [];
        this.children.forEach(child => child.parent = this);
    }

    private detach() {
        if (this.parent) {
            this.parent.children.splice(this.parent.children.indexOf(this), 1);
            this.parent.mutations.remove++;
            this.parent = undefined;
        }
    }
}

const row = (id: string, focused = false, open = false) => {
    const node = new TreeNode("LI", id);
    node.arrow = new TreeNode("SPAN");
    if (focused) {
        node.classList.add("b3-list-item--focus");
    }
    if (open) {
        node.arrow.classList.add("b3-list-item__arrow--open");
    }
    return node;
};

const list = (...children: TreeNode[]) => {
    const node = new TreeNode("UL");
    node.children = children;
    children.forEach(child => child.parent = node);
    return node;
};

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
    if (descriptor) {
        Object.defineProperty(globalThis, "document", descriptor);
    } else {
        Reflect.deleteProperty(globalThis, "document");
    }
});

const refresh = (root: TreeNode, newRows: TreeNode[], selected?: TreeNode) => {
    const template = {
        content: list(...newRows),
        set innerHTML(value: string) {
            assert.equal(value, "fresh rows");
        },
        get innerHTML(): string {
            return assert.fail("Expanded subtrees must not be serialized and reparsed");
        },
    };
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {createElement: (tag: string) => {
            assert.equal(tag, "template");
            return template;
        }},
    });
    return refreshFileTreeChildren(root as unknown as Element, "fresh rows", selected as unknown as Element);
};

test("refresh preserves expanded descendants and their selection while applying the new row order", () => {
    const leaf = row("leaf", true);
    const subtree = list(leaf);
    const oldA = row("a", true, true);
    oldA.label = "old";
    const oldB = row("b");
    const root = list(oldA, subtree, oldB);
    const a = row("a");
    const b = row("b");
    assert.equal(refresh(root, [b, a], leaf), leaf);
    assert.deepEqual(root.children, [oldB, a, subtree]);
    assert.equal(subtree.children[0], leaf);
    assert.equal(a.classList.contains("b3-list-item--focus"), true);
    assert.equal(a.arrow.classList.contains("b3-list-item__arrow--open"), true);
    assert.equal(leaf.classList.contains("b3-list-item--focus"), true);
});

test("a replaced direct selection follows its new row and selections outside the refreshed branch stay intact", () => {
    const old = row("a", true);
    old.label = "old";
    const replacement = row("a");
    const root = list(old);
    assert.equal(refresh(root, [replacement], old), replacement);
    const outside = row("other");
    assert.equal(refresh(root, [row("a")], outside), outside);
});

test("removed documents discard their expanded subtree and clear the selection anchor", () => {
    const leaf = row("leaf", true);
    const root = list(row("a", false, true), list(leaf), row("b"));
    const b = row("b");
    assert.equal(refresh(root, [b], leaf), null);
    assert.deepEqual(root.children.map(node => node.id), ["b"]);
    assert.equal(root.contains(leaf), false);
});

test("a collapsing subtree is not reopened or reused", () => {
    const root = list(row("a"), list(row("leaf")));
    const retained = root.children[0];
    const replacement = row("a");
    refresh(root, [replacement]);
    assert.deepEqual(root.children, [retained]);
    assert.equal(replacement.arrow.classList.contains("b3-list-item__arrow--open"), false);
});

test("wide multi-selection refreshes do not search the new row list repeatedly", () => {
    const oldRows = Array.from({length: 10000}, (_, index) => row(String(index), true));
    const newRows = oldRows.map(node => row(node.id)).reverse();
    const root = list(...oldRows);
    refresh(root, newRows);
    assert.deepEqual(root.children, oldRows.slice().reverse());
    assert.equal(root.children.every(node => node.classList.contains("b3-list-item--focus")), true);
});

test("unchanged rows remain mounted and an unchanged direct selection preserves its node", () => {
    const selected = row("a", true, true);
    const subtree = list(row("leaf"));
    const root = list(selected, subtree, row("b"));
    assert.equal(refresh(root, [row("a"), row("b")], selected), selected);
    assert.equal(root.children[0], selected);
    assert.deepEqual(root.mutations, {insert: 0, remove: 0});
});

test("renaming one row in ten thousand only replaces that row", () => {
    const old = Array.from({length: 10000}, (_, index) => row(String(index)));
    const fresh = old.map(node => row(node.id));
    fresh[5000].label = "renamed";
    const root = list(...old);
    refresh(root, fresh);
    assert.equal(root.children[5000], fresh[5000]);
    assert.equal(root.children.filter((node, index) => node === old[index]).length, 9999);
    assert.deepEqual(root.mutations, {insert: 1, remove: 1});
});

test("data-based refresh parses only changed rows and invalidates every row when rendering context changes", () => {
    const files = Array.from({length: 10000}, (_, index) => ({id: String(index), title: "current"}));
    const root = list();
    let rendered = 0;
    let parsed = 0;
    Object.defineProperty(globalThis, "document", {configurable: true, value: {createElement: () => ({
        content: {children: [] as TreeNode[]},
        set innerHTML(html: string) {
            const descriptors = html.split("\n").filter(Boolean).map(line => JSON.parse(line));
            parsed += descriptors.length;
            this.content.children = descriptors.map(file => { const node = row(file.id); node.label = file.title; return node; });
        },
    })}});
    const render = (file: typeof files[number]) => { rendered++; return JSON.stringify(file) + "\n"; };
    const refreshData = (context = "default") => refreshFileTreeRows(root as unknown as Element, files, context, render);
    refreshData();
    assert.equal(rendered, 10000);
    assert.equal(parsed, 10000);
    const original = root.children.slice();
    parsed = rendered = 0;
    refreshData();
    assert.equal(rendered, 0);
    assert.equal(parsed, 0);
    assert.deepEqual(root.children, original);
    files[7000].title = "renamed";
    refreshData();
    assert.equal(rendered, 1);
    assert.equal(parsed, 1);
    assert.equal(root.children[7000].label, "renamed");
    assert.equal(root.children.filter((node, index) => node === original[index]).length, 9999);
    parsed = rendered = 0;
    refreshData("readonly-with-new-icons");
    assert.equal(rendered, 10000);
    assert.equal(parsed, 10000);
    const retained = root.children[7000];
    retained.remove();
    parsed = rendered = 0;
    refreshData("readonly-with-new-icons");
    assert.equal(rendered, 1);
    assert.equal(parsed, 1);
    assert.equal(root.children[7000].id, "7000");
});

test("stable data updates preserve expanded selections and repair externally reordered rows", () => {
    const files = [{id: "a", title: "current"}, {id: "b", title: "current"}];
    const root = list();
    Object.defineProperty(globalThis, "document", {configurable: true, value: {createElement: () => ({
        content: {children: [] as TreeNode[]},
        set innerHTML(html: string) {
            this.content.children = html.split("\n").filter(Boolean).map(line => {
                const file = JSON.parse(line);
                const node = row(file.id);
                node.label = file.title;
                return node;
            });
        },
    })}});
    const update = (selection?: TreeNode) => refreshFileTreeRows(root as unknown as Element, files, "default",
        file => JSON.stringify(file) + "\n", selection as unknown as Element);
    update();
    const a = root.children[0];
    a.arrow.classList.add("b3-list-item__arrow--open");
    const leaf = row("leaf", true);
    const subtree = list(leaf);
    a.after(subtree);
    files[0].title = "renamed";
    assert.equal(update(leaf), leaf);
    assert.equal(root.children[0].label, "renamed");
    assert.equal(root.children[1], subtree);
    assert.equal(root.children[0].arrow.classList.contains("b3-list-item__arrow--open"), true);
    const retained = root.children[0];
    root.insertBefore(root.children[2], retained);
    assert.equal(update(leaf), leaf);
    assert.deepEqual(root.children, [retained, subtree, root.children[2]]);
    files.shift();
    assert.equal(update(leaf), null);
    assert.deepEqual(root.children.map(item => item.id), ["b"]);
});
