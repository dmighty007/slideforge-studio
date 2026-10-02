export class ElkLayoutAdapter {
    static available() {
        return false;
    }

    static async layout(document) {
        return document;
    }
}
