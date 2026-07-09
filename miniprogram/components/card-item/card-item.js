Component({
  properties: {
    card: {
      type: Object,
      value: {}
    },
    showQuantity: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { card: this.data.card });
    }
  }
});
