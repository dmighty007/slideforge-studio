export class GraphSelection {
    static toggle(ids = [], id) {
        return ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
    }
}
