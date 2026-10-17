export const updateFrozenColumns = (blockElement: HTMLElement) => {
    if (blockElement.dataset.avType !== "table") {
        return;
    }
    const scrollElement = blockElement.querySelector<HTMLElement>(".av__scroll");
    const viewportWidth = scrollElement?.clientWidth;
    if (!viewportWidth) {
        return;
    }
    // 为未固定列保留至少 80 像素，宽度不足时仅暂停当前视图的固定定位。
    const updates = Array.from(blockElement.querySelectorAll<HTMLElement>(".av__body")).map(body => {
        const frozen = body.querySelector<HTMLElement>(".av__row--header .av__colsticky--freeze");
        return {body, suspended: !!frozen && frozen.getBoundingClientRect().width + 80 > viewportWidth};
    });
    updates.forEach(({body, suspended}) => {
        body.classList.toggle("av__body--unfreeze", suspended);
    });
};
