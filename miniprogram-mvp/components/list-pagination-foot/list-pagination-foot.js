Component({
  properties: {
    total: {
      type: Number,
      value: 0
    },
    loading: {
      type: Boolean,
      value: false
    },
    hasMore: {
      type: Boolean,
      value: false
    }
  },

  observers: {
    total: function(total) {
      this.setData({ show: total > 0 })
    }
  },

  data: {
    show: false
  }
})
