<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Table as TTable, Pagination as TPagination } from 'tdesign-vue-next';

const props = withDefaults(defineProps<{
  data: any[];
  columns: any[];
  loading?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  rowKey?: string;
  bordered?: boolean;
  size?: 'small' | 'medium';
  emptyText?: string;
}>(), {
  loading: false,
  pageSize: 10,
  pageSizeOptions: () => [10, 20, 50],
  rowKey: 'id',
  bordered: false,
  size: 'small',
});

const currentPage = ref(1);
const currentPageSize = ref(props.pageSize);

watch(() => props.data.length, () => { currentPage.value = 1; });

const pagedData = computed(() => {
  const start = (currentPage.value - 1) * currentPageSize.value;
  return props.data.slice(start, start + currentPageSize.value);
});

const showPagination = computed(() => props.data.length > currentPageSize.value);
</script>

<template>
  <t-table
    :data="pagedData"
    :columns="columns"
    :loading="loading"
    :row-key="rowKey"
    :bordered="bordered"
    :size="size"
  >
    <template v-for="(_, name) in $slots" #[name]="slotData">
      <slot :name="name" v-bind="slotData ?? {}" />
    </template>
  </t-table>
  <div v-if="showPagination" class="pagination-wrap">
    <t-pagination
      v-model="currentPage"
      v-model:page-size="currentPageSize"
      :total="props.data.length"
      :page-size-options="pageSizeOptions"
      size="small"
    />
  </div>
</template>

<style scoped>
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 4px;
}
</style>
