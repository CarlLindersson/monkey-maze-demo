class Random {
    constructor(seed) {
        this.seed = seed;
    }

    random() {
        const x = Math.sin(this.seed++) * 10000;
        return x - Math.floor(x);
    }

    choice(array) {
        const index = Math.floor(this.random() * array.length);
        return array[index];
    }
}

export default Random;
