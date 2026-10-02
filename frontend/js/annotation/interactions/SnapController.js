export class SnapController {
    static snapPointToSlideGuides(point, slideWidth, slideHeight, threshold = 6) {
        const guides = [0, slideWidth / 2, slideWidth].map(x => ({ axis: "x", value: x })).concat(
            [0, slideHeight / 2, slideHeight].map(y => ({ axis: "y", value: y })),
        );
        return guides.reduce((next, guide) => {
            if (Math.abs(next[guide.axis] - guide.value) <= threshold) next[guide.axis] = guide.value;
            return next;
        }, { ...point });
    }
}
