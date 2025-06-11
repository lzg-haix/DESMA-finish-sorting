import axios from 'axios'

// oepas_dev2 - dev-inpos
export const PAS = axios.create({
  baseURL: 'http://192.168.61.101:8090/WApp_FinSort/web/pdo/WApp_FinSortService',
  headers: {
    'Content-Type': 'application/json',
  },
})
